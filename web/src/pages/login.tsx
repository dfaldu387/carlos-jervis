import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useT } from '@/lib/i18n';
import type { DemoAccount } from '@/lib/types';

export function LoginPage() {
  const { signIn } = useAuth();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const demo = useQuery({ queryKey: ['demo-accounts'], queryFn: () => api.demoAccounts(), staleTime: Infinity });
  // Single sign-on is offered only when the server has an identity provider configured.
  const sso = useQuery({ queryKey: ['sso'], queryFn: () => api.sso(), staleTime: Infinity });
  const ssoError = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('sso_error') : null;

  useEffect(() => emailRef.current?.focus(), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError(t('login.missing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(email.trim(), password);
      signIn(user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('login.failed'));
      setBusy(false);
    }
  };

  const fill = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(account.password);
    setError(null);
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-7 shadow-md">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">J</span>
          <div>
            <div className="text-lg font-bold leading-tight text-foreground">{t('app.name')}</div>
            <div className="text-xs text-muted-foreground">{t('app.tagline')}</div>
          </div>
        </div>

        <h1 className="text-xl font-semibold text-foreground">{t('login.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('login.subtitle')}</p>

        {ssoError ? <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t('login.ssoError', { code: ssoError })}</p> : null}

        {sso.data?.enabled && sso.data.loginPath ? (
          <div className="mt-5 flex flex-col gap-3">
            <Button size="lg" variant="secondary" onClick={() => window.location.assign(`${sso.data!.loginPath}?next=${encodeURIComponent('/')}`)}>
              <svg aria-hidden="true" viewBox="0 0 21 21" className="h-4 w-4">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              {sso.data.label ?? t('login.sso')}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              {t('login.or')}
              <Separator className="flex-1" />
            </div>
          </div>
        ) : null}

        <form className="mt-5 flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t('login.email')}</Label>
            <Input
              id="email"
              ref={emailRef}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@jervis.local"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t('login.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
            />
          </div>
          {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>

        {demo.data?.accounts.length ? (
          <div className="mt-6 border-t border-border pt-5">
            <div className="mb-2.5 flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t('login.demo')}</span>
              <span className="text-muted-foreground">{t('login.clickToFill')}</span>
            </div>
            <div className="flex flex-col gap-2">
              {demo.data.accounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => fill(account)}
                  className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-left transition-colors hover:bg-secondary"
                >
                  <span className="text-sm font-semibold text-foreground">{account.roleName}</span>
                  <span className="font-mono text-xs text-muted-foreground">{account.email}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
