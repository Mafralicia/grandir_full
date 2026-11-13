import { addDays } from '@grandir/engines';
import { seededRandom } from '../connectors/demo';
import { nowIso } from '../db';
import type { TenantScope } from '../tenant';
import { openClaim, transitionClaim } from './claims';

const ACTOR = 'Equipe Grandir (simulação)';

/**
 * Exclusivo do ambiente de demonstração: abre chamados para as divergências
 * sintéticas e simula o andamento que eles teriam tido junto ao marketplace,
 * para que o portal possa ser avaliado com um histórico completo.
 * Passos cuja data cairia no futuro não são aplicados — os chamados mais
 * recentes ficam naturalmente em andamento.
 */
export function simulateDemoHistory(scope: TenantScope, storeId: string): void {
  const random = seededRandom(`grandir-demo-historico:${storeId}`);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const chance = (probability: number) => random() < probability;
  const now = nowIso();

  const discrepancies = scope.all<{ id: string; occurred_at: string; estimated_value_cents: number }>(
    `SELECT id, occurred_at, estimated_value_cents FROM discrepancies
      WHERE tenant_id = :tenantId AND store_id = :storeId AND status = 'OPEN'
      ORDER BY occurred_at, fingerprint`,
    { storeId },
  );

  scope.transaction(() => {
    for (const discrepancy of discrepancies) {
      if (chance(0.12)) continue;

      let at = addDays(discrepancy.occurred_at, int(31, 44));
      if (at > now) continue;
      const claim = openClaim(scope, discrepancy.id, ACTOR, at);

      const step = (to: Parameters<typeof transitionClaim>[2], days: [number, number], note: string, approvedCents?: number) => {
        at = addDays(at, int(days[0], days[1]));
        if (at > now) return false;
        transitionClaim(scope, claim.id, to, { actor: ACTOR, at, note, approvedCents });
        return true;
      };
      const caseId = `CASO-${int(10_000_000, 99_999_999)}`;
      at = addDays(at, int(2, 5));
      if (at > now) continue;
      transitionClaim(scope, claim.id, 'UNDER_REVIEW', {
        actor: ACTOR, at, marketplaceCaseId: caseId, note: 'Caso em análise pelo marketplace.',
      });

      if (chance(0.2)) {
        if (!step('NEEDS_DOCUMENTS', [3, 8], 'O marketplace pediu nota fiscal de compra e comprovante de entrega.')) continue;
        if (chance(0.35)) continue;
        if (!step('UNDER_REVIEW', [4, 10], 'Documentos enviados; caso de volta à análise.')) continue;
      }

      const outcome = random();
      const partial = Math.round((claim.claimed_cents * int(50, 85)) / 100);
      if (outcome < 0.7) {
        if (!step('APPROVED', [7, 25], 'Reembolso aprovado pelo valor integral.')) continue;
        step('PAID', [3, 10], 'Reembolso creditado na conta do seller.');
      } else if (outcome < 0.84) {
        if (!step('PARTIALLY_APPROVED', [7, 25], 'Reembolso aprovado parcialmente.', partial)) continue;
        step('PAID', [3, 10], 'Reembolso creditado na conta do seller.');
      } else {
        if (!step('DENIED', [7, 25], 'Pedido negado na primeira análise.')) continue;
        if (chance(0.4)) continue;
        if (!step('REOPENED', [4, 9], 'Caso reaberto com evidências adicionais.')) continue;
        if (!step('UNDER_REVIEW', [1, 3], 'Reanálise em andamento.')) continue;
        if (chance(0.6)) {
          if (!step('APPROVED', [8, 20], 'Reembolso aprovado após reabertura.')) continue;
          step('PAID', [3, 10], 'Reembolso creditado na conta do seller.');
        } else {
          step('DENIED', [8, 20], 'Negativa mantida após reanálise.');
        }
      }
    }
  });
}
