import { chunk } from 'lodash';
import { v4 as uuid } from 'uuid';

import {
  createDirectRelationship,
  Entity,
  IntegrationStep,
  IntegrationStepExecutionContext,
  Relationship,
  RelationshipClass,
} from '@jupiterone/integration-sdk-core';

import { createQualysAPIClient } from '../../provider';
import { QWebHostId } from '../../provider/client';
import { ListScannedHostIdsFilters } from '../../provider/client/types/vmpc';
import { QualysIntegrationConfig } from '../../types';
import { buildKey } from '../../util';
import { DATA_VMDR_SERVICE_ENTITY, STEP_FETCH_SERVICES } from '../services';
// import { VulnerabilityFindingKeysCollector } from '../utils';
import {
  DATA_HOST_TARGETS,
  // DATA_HOST_VULNERABILITY_FINDING_KEYS,
  DATA_SCANNED_HOST_IDS,
  STEP_FETCH_SCANNED_HOST_DETAILS,
  STEP_FETCH_SCANNED_HOST_FINDINGS,
  STEP_FETCH_SCANNED_HOST_IDS,
  VmdrEntities,
  VmdrRelationships,
} from './constants';
import {
  createHostFindingEntity,
  createServiceScansDiscoveredHostRelationship,
  createServiceScansEC2HostRelationship,
  getEC2HostArn,
  getTargetsFromHostAsset,
} from './converters';
import { HostAssetTargetsMap } from './types';

/**
 * Fetches the set of scanned host IDs that will be processed by the
 * integration. This step may be changed to reduce the set of processed hosts.
 */
export async function fetchScannedHostIds({
  logger,
  instance,
  jobState,
}: IntegrationStepExecutionContext<QualysIntegrationConfig>) {
  const apiClient = createQualysAPIClient(logger, instance.config);

  const filters: ListScannedHostIdsFilters = {
    vm_scan_date_after: instance.config.minScannedSinceISODate,
    vm_scan_date_before: instance.config.maxScannedSinceISODate,
  };

  const loggerFetch = logger.child({ filters });

  let loggedIdsDataType = false;
  const hostIds: QWebHostId[] = [];
  await apiClient.iterateScannedHostIds(
    (pageOfIds) => {
      for (const hostId of pageOfIds) {
        if (!loggedIdsDataType && typeof hostId !== 'number') {
          loggerFetch.info(
            { hostId, type: typeof hostId },
            'Data type of host id is not number',
          );
          loggedIdsDataType = true;
        }
        hostIds.push(hostId);
      }
      loggerFetch.info(
        { numScannedHostIds: hostIds.length },
        'Fetched page of scanned host IDs',
      );
    },
    {
      filters,
    },
  );

  await jobState.setData(DATA_SCANNED_HOST_IDS, hostIds);

  loggerFetch.info(
    { numScannedHostIds: hostIds.length },
    'Finished fetching scanned host IDs',
  );

  loggerFetch.publishEvent({
    name: 'stats',
    description: `Found ${hostIds.length} hosts with filters: ${JSON.stringify(
      filters,
    )}`,
  });
}

/**
 * Fetches scanned host details and creates mapped relationships between the
 * Service and Host entities.
 *
 * Qualys does not own Host entities, it scans them, so it is important to allow
 * the system mapper to connect the Service to existing Host entities.
 */
export async function fetchScannedHostDetails({
  logger,
  instance,
  jobState,
}: IntegrationStepExecutionContext<QualysIntegrationConfig>) {
  const hostIds = ((await jobState.getData(DATA_SCANNED_HOST_IDS)) ||
    []) as number[];
  const vdmrServiceEntity = (await jobState.getData(
    DATA_VMDR_SERVICE_ENTITY,
  )) as Entity;
  const apiClient = createQualysAPIClient(logger, instance.config);

  let totalHostsProcessed = 0;
  const totalPageErrors = 0;
  const errorCorrelationId = uuid();

  const hostAssetTargetsMap: HostAssetTargetsMap = {};
  await apiClient.iterateHostDetails(
    hostIds,
    async (host) => {
      if (getEC2HostArn(host)) {
        await jobState.addRelationship(
          createServiceScansEC2HostRelationship(vdmrServiceEntity, host),
        );
      } else {
        await jobState.addRelationship(
          createServiceScansDiscoveredHostRelationship(vdmrServiceEntity, host),
        );
      }

      // Ensure that `DATA_HOST_TARGETS` is updated for each host so that should
      // a partial set be ingested, we don't lose what we've seen for later
      // steps.
      if (host.qwebHostId) {
        hostAssetTargetsMap[host.qwebHostId] = getTargetsFromHostAsset(host);
        await jobState.setData(DATA_HOST_TARGETS, hostAssetTargetsMap);
      } else {
        logger.info(
          { host: { id: host.id } },
          'Unable to store targets for host asset. This may affect global mappings.',
        );
      }

      totalHostsProcessed++;
    },
    {
      onRequestError(pageIds, err) {
        logger.error(
          { pageIds, err, errorCorrelationId },
          'Error ingesting page of scanned host details',
        );
      },
    },
  );

  logger.publishEvent({
    name: 'stats',
    description: `Processed details for ${totalHostsProcessed} of ${
      hostIds.length
    } hosts${
      totalPageErrors > 0
        ? `, encountered errors on ${totalPageErrors} pages (errorId="${errorCorrelationId}")`
        : ''
    }`,
  });
}

/**
 * Fetches scanned host vulnerability detections to create Finding entities and
 * relationships between the Service and Finding. The step also tracks the
 * finding keys per vulnerability ID for use in collecting the vulnerabilty
 * details in a later step.
 */
export async function fetchScannedHostFindings({
  logger,
  instance,
  jobState,
}: IntegrationStepExecutionContext<QualysIntegrationConfig>) {
  const apiClient = createQualysAPIClient(logger, instance.config);

  const hostIds = ((await jobState.getData(DATA_SCANNED_HOST_IDS)) ||
    []) as number[];
  const hostTargetsMap = ((await jobState.getData(DATA_HOST_TARGETS)) ||
    {}) as HostAssetTargetsMap;

  const serviceEntity = (await jobState.getData(
    DATA_VMDR_SERVICE_ENTITY,
  )) as Entity;

  let totalHostsProcessed = 0;
  const totalPageErrors = 0;
  const errorCorrelationId = uuid();

  // const vulnerabilityFindingKeysCollector = new VulnerabilityFindingKeysCollector();
  await apiClient.iterateHostDetections(
    hostIds,
    async ({ host, detections }) => {
      logger.info(
        {
          hostId: host.ID,
          detectionCount: detections.length,
        },
        'Processing host detections...',
      );

      const seenHostFindingEntityKeys = new Set<string>();

      // TODO: consider having jobState.batch(detections, ([detection, ...]) => {...})
      // so that we don't have to know what the optimal batch size it
      for (const batchDetections of chunk(detections, 500)) {
        const entities: Entity[] = [];
        const relationships: Relationship[] = [];

        for (const detection of batchDetections) {
          const findingKey = buildKey({
            qid: detection.QID,
            type: detection.TYPE,
            port: detection.PORT,
            protocol: detection.PROTOCOL,
            ssl: detection.SSL,
            hostId: host.ID,
          });

          if (seenHostFindingEntityKeys.has(findingKey)) continue;

          seenHostFindingEntityKeys.add(findingKey);
          // vulnerabilityFindingKeysCollector.addVulnerabilityFinding(
          //   detection.QID!,
          //   findingKey,
          // );

          const findingEntity = createHostFindingEntity(
            findingKey,
            host,
            detection,
            hostTargetsMap[host.ID!],
          );
          entities.push(findingEntity);

          relationships.push(
            createDirectRelationship({
              _class: RelationshipClass.IDENTIFIED,
              from: serviceEntity,
              to: findingEntity,
            }),
          );
        }

        await jobState.addEntities(entities);
        await jobState.addRelationships(relationships);
      }

      logger.info(
        {
          hostId: host.ID,
          detectionCount: detections.length,
        },
        'Processing host detections completed.',
      );

      // Ensure that `DATA_HOST_VULNERABILITY_FINDING_KEYS` is updated for each host
      // so that should a partial set be ingested, we don't lose what we've seen
      // for later steps.
      // await jobState.setData(
      //   DATA_HOST_VULNERABILITY_FINDING_KEYS,
      //   vulnerabilityFindingKeysCollector.toVulnerabilityFindingKeys(),
      // );

      totalHostsProcessed++;
    },
    {
      filters: {
        detection_updated_since: instance.config.minFindingsSinceISODate,
        detection_updated_before: instance.config.maxFindingsSinceISODate,
      },
      onRequestError(pageIds, err) {
        logger.error(
          { pageIds, err, errorCorrelationId },
          'Error ingesting detections processing page of hosts',
        );
      },
      logger,
    },
  );

  logger.publishEvent({
    name: 'stats',
    description: `Processed detections for ${totalHostsProcessed} of ${
      hostIds.length
    } hosts${
      totalPageErrors > 0
        ? `, encountered errors on ${totalPageErrors} pages (errorId="${errorCorrelationId}")`
        : ''
    }`,
  });
}

export const hostDetectionSteps: IntegrationStep<QualysIntegrationConfig>[] = [
  {
    id: STEP_FETCH_SCANNED_HOST_IDS,
    name: 'Fetch Scanned Host IDs',
    entities: [],
    relationships: [],
    dependsOn: [],
    executionHandler: fetchScannedHostIds,
  },
  {
    id: STEP_FETCH_SCANNED_HOST_DETAILS,
    name: 'Fetch Scanned Host Details',
    entities: [],
    relationships: [
      VmdrRelationships.SERVICE_DISCOVERED_HOST,
      VmdrRelationships.SERVICE_EC2_HOST,
    ],
    dependsOn: [STEP_FETCH_SERVICES, STEP_FETCH_SCANNED_HOST_IDS],
    executionHandler: fetchScannedHostDetails,
  },
  {
    id: STEP_FETCH_SCANNED_HOST_FINDINGS,
    name: 'Fetch Scanned Host Findings',
    entities: [VmdrEntities.HOST_FINDING],
    relationships: [
      VmdrRelationships.SERVICE_HOST_FINDING,

      // Global mappings will do the work of building a relationship between the
      // `Finding` and `Host` entities. It depends on the `Finding.targets`
      // containing a value that matches certain properties on the `Host`.
    ],
    dependsOn: [STEP_FETCH_SCANNED_HOST_DETAILS],
    executionHandler: fetchScannedHostFindings,
  },
];
