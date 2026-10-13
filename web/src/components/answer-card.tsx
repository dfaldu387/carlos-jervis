import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { titleCase } from '@/lib/utils';
import { AnswerPayloads } from '@/components/answer-payloads';
import { useI18n, useT } from '@/lib/i18n';
import type { AskResult } from '@/lib/types';

function formatValue(value: unknown, format?: string, locale = 'en-GB'): string {
  const n = Number(value);
  if (format === 'percent' && Number.isFinite(n)) return `${(n * 100).toFixed(1)}%`;
  if (format === 'minutes' && Number.isFinite(n)) {
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }
  if (format === 'currency' && Number.isFinite(n)) return n.toLocaleString(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  if (format === 'integer' && Number.isFinite(n)) return n.toLocaleString(locale);
  return value == null ? '—' : String(value);
}

export function AnswerCard({ result, onFollowUp }: { result: AskResult; onFollowUp?: (q: string) => void }) {
  const a = result.answer;
  const t = useT();
  const { locale } = useI18n();
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{a.headline}</h3>
        {a.provider ? <Badge variant="muted">{a.provider === 'claude' ? t('answer.ai') : t('answer.template')}</Badge> : null}
      </div>

      {a.metrics && a.metrics.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {a.metrics.map((m) => (
            <div key={m.key} className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="text-xs font-medium text-muted-foreground">{m.label}</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{formatValue(m.value, m.format, locale)}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {titleCase(m.source)}
                {m.restricted ? ` · ${t('answer.restricted')}` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {a.narrative && a.narrative.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 text-sm leading-relaxed text-foreground">
          {a.narrative.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}

      {a.tables?.map((t) => (
        <div key={t.id} className="mt-4">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.title}</div>
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  {t.columns.map((c) => (
                    <TableHead key={c.key}>{c.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.rows.slice(0, 8).map((row, i) => (
                  <TableRow key={i}>
                    {t.columns.map((c) => (
                      <TableCell key={c.key}>{formatValue(row[c.key], c.format, locale)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}

      <AnswerPayloads result={result} />

      {result.sources && result.sources.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('answer.sources')}</span>
          {result.sources.map((s) => (
            <span key={`${s.source}:${s.object}`} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs text-foreground">
              {s.label}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="text-primary">
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {a.followUps && a.followUps.length > 0 && onFollowUp ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {a.followUps.map((f) => (
            <Button key={f} variant="secondary" size="sm" onClick={() => onFollowUp(f)}>
              {f}
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
