import type { Session } from '@sirene/shared';
import { NotFoundError } from '../errors';
import { generationRepository, sessionRepository } from '../repositories';

interface CreateSessionInput {
  name?: string;
  generations?: string[];
}

interface UpdateSessionInput {
  name?: string | null;
  generations?: string[];
}

class SessionService {
  public async listForUser(userId: string): Promise<Session[]> {
    return sessionRepository.getAllBy(`user = "${userId}"`, { sort: '-updated' }) as Promise<Session[]>;
  }

  public async getOwned(id: string, userId: string): Promise<Session> {
    const session = (await sessionRepository.getOne(id)) as Session | null;
    if (!session || session.user !== userId) {
      throw new NotFoundError('Session not found');
    }
    return session;
  }

  public async create(userId: string, input: CreateSessionInput): Promise<Session> {
    return sessionRepository.create({
      name: input.name ?? '',
      user: userId,
      generations: input.generations ?? [],
    }) as Promise<Session>;
  }

  public async update(id: string, userId: string, input: UpdateSessionInput): Promise<Session> {
    await this.getOwned(id, userId);
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      patch.name = input.name ?? '';
    }
    if (input.generations !== undefined) {
      patch.generations = input.generations;
    }
    return sessionRepository.update(id, patch) as Promise<Session>;
  }

  public async delete(id: string, userId: string): Promise<void> {
    await this.getOwned(id, userId);
    await sessionRepository.delete(id);
  }

  /** Toggle public sharing. The flag must propagate to every generation in the session because
   *  PB gates audio file URLs on the parent record's viewRule, and there's no way to walk a
   *  back-relation in a rule expression. We denormalise here in one transactionish loop. */
  public async setPublic(id: string, userId: string, isPublic: boolean): Promise<Session> {
    const existing = await this.getOwned(id, userId);

    const generationIds = Array.isArray(existing.generations) ? existing.generations : [];
    const updated = (await sessionRepository.update(id, { public: isPublic })) as Session;

    // Best-effort denormalisation. We only swallow PB 404s (the referenced generation
    // was deleted) - anything else (PB unreachable, validation failure) is a transient
    // problem we surface so the caller doesn't see a clean 200 while half the linked
    // records were never touched.
    const settled = await Promise.allSettled(generationIds.map((genId) => generationRepository.update(genId, { public: isPublic })));
    for (const result of settled) {
      if (result.status === 'rejected' && !isMissingRecord(result.reason)) {
        throw result.reason;
      }
    }

    return updated;
  }
}

function isMissingRecord(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 404;
}

export const sessionService = new SessionService();
