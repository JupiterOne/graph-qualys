import { IntegrationError } from '@jupiterone/integration-sdk-core';

import { NormalizedNumericSeverity, QualyNumericSeverity } from '../types';

/**
 * Maps a Qualys vulnerability QID to the set of related `Finding._key` values.
 *
 * As Findings are created during the processing of `HostDetection` data, the
 * QID and `Finding._key` values are easily obtained, and therefore tracked for
 * a later step that will fetch vulnerabilities and create mapped relationships
 * between the Finding and Vulnerabilty.
 */
export type SerializedVulnerabilityFindingKeys = [number, Set<string>][];

export type VulnerabilityFindingKeysMap = Map<number, Set<string>>;

export class VulnerabilityFindingKeysCollector {
  private mapping: VulnerabilityFindingKeysMap;

  constructor() {
    this.mapping = new Map();
  }

  public allQids(): number[] {
    return Array.from(this.mapping.keys());
  }

  /**
   * Adds a Finding._key to set of vulnerability findings.
   *
   * @param qid vulnerability QID
   * @param findingKey Finding._key related to vulnerability
   */
  public addVulnerabilityFindingKey(qid: number, findingKey: string): void {
    if (!qid)
      throw new IntegrationError({
        code: 'UNDEFINED_VULNERABILITY_QID',
        message: 'undefined QID provided for vulnerability',
      });

    let keys = this.mapping.get(qid);
    if (!keys) {
      keys = new Set();
      this.mapping.set(qid, keys);
    }
    keys.add(findingKey);
  }

  public getVulnerabiltyFindingKeys(qid: number): string[] {
    return Array.from(this.mapping.get(qid) || []);
  }

  /**
   * Serializes collected values into form that can be stored between steps and
   * used to re-create the Map.
   */
  public serialize(): SerializedVulnerabilityFindingKeys {
    return Array.from(this.mapping.entries());
  }

  /**
   * Adds values previously serialized.
   */
  public loadSerialized(serialized: SerializedVulnerabilityFindingKeys) {
    for (const [qid, findingKeys] of serialized) {
      let existingFindingKeys = this.mapping.get(qid);
      if (!existingFindingKeys) {
        existingFindingKeys = new Set();
        this.mapping.set(qid, existingFindingKeys);
      }
      for (const findingKey of findingKeys) {
        existingFindingKeys.add(findingKey);
      }
    }
  }
}

const SEVERITY_MAPPINGS = [
  'none',
  'informational',
  'low',
  'medium',
  'high',
  'critical',
];

export function convertNumericSeverityToString(
  numericSeverity: QualyNumericSeverity,
): string {
  if (numericSeverity === undefined || numericSeverity < 0) {
    return SEVERITY_MAPPINGS[1];
  }
  return numericSeverity <= 5 ? SEVERITY_MAPPINGS[numericSeverity] : 'critical';
}

export function normalizeNumericSeverity(
  numericSeverity: QualyNumericSeverity,
): NormalizedNumericSeverity {
  if (numericSeverity === undefined || numericSeverity <= 1) return 1;
  return (numericSeverity <= 5
    ? numericSeverity * 2
    : 10) as NormalizedNumericSeverity;
}
