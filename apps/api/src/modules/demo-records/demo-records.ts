// FIXTURE ONLY: synthetic learner-owned records that exercise the identity
// access rule (T3-004-A) before real learner data exists. Remove this module
// once a real owned resource, such as tutoring history (T3-007-D), applies the rule.
import { ownedScope, type OwnedScope, type Principal } from '../identity/domain/principal.ts';

export interface DemoRecord {
  readonly id: string;
  readonly courseId: string;
  readonly body: string;
}

export interface DemoRecordRepository {
  /** Records inside the scope only; filtering happens in storage, not after loading. */
  list(scope: OwnedScope): Promise<DemoRecord[]>;
  /** Null when the record is missing or outside the scope, indistinguishably. */
  find(id: string, scope: OwnedScope): Promise<DemoRecord | null>;
}

export class DemoRecords {
  readonly #repository: DemoRecordRepository;

  constructor(repository: DemoRecordRepository) {
    this.#repository = repository;
  }

  async list(principal: Principal): Promise<DemoRecord[]> {
    const scope = ownedScope(principal);
    return scope ? this.#repository.list(scope) : [];
  }

  async get(principal: Principal, id: string): Promise<DemoRecord | null> {
    const scope = ownedScope(principal);
    return scope ? this.#repository.find(id, scope) : null;
  }
}
