import { useState } from 'react';
import { Pencil, Check, KeyRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { initialsOf } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ProfileCard() {
  const { user, setUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError('Name is required.');
    setBusy(true);
    setError(null);
    try {
      const { user: updated } = await api.updateProfile({ name: name.trim(), jobTitle: jobTitle.trim() });
      setUser(updated);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-primary/15 text-lg font-semibold text-primary">{initialsOf(user?.name)}</span>
          <div className="min-w-0">
            <div className="text-lg font-bold text-foreground">{user?.name}</div>
            <div className="text-sm text-muted-foreground">{user?.jobTitle} · {user?.roleName}</div>
          </div>
        </div>
        {!editing ? <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button> : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <div><Label htmlFor="n">Full name</Label><Input id="n" className="mt-1" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label htmlFor="jt">Job title</Label><Input id="jt" className="mt-1" maxLength={80} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></div>
          {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}><Check /> {busy ? 'Saving…' : 'Save changes'}</Button>
            <Button variant="secondary" size="sm" onClick={() => { setEditing(false); setName(user?.name ?? ''); setJobTitle(user?.jobTitle ?? ''); setError(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Email</dt><dd className="text-foreground">{user?.email ?? '—'}</dd>
          <dt className="text-muted-foreground">Role</dt><dd className="text-foreground">{user?.roleName}</dd>
          {user?.permissions?.length ? (<><dt className="text-muted-foreground">Permissions</dt><dd className="font-mono text-xs text-foreground">{user.permissions.join(', ')}</dd></>) : null}
        </dl>
      )}
      {saved ? <p className="mt-3 flex items-center gap-1.5 text-sm text-success"><Check className="h-4 w-4" /> Profile updated.</p> : null}
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('New password and confirmation do not match.');
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl p-5">
      <div className="mb-1 flex items-center gap-2"><KeyRound className="h-[17px] w-[17px] text-primary" /><h2 className="text-base font-semibold text-foreground">Reset password</h2></div>
      <p className="mb-3 text-xs text-muted-foreground">Choose a new password of at least 8 characters.</p>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <div><Label htmlFor="cp">Current password</Label><Input id="cp" type="password" autoComplete="current-password" className="mt-1" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div><Label htmlFor="np">New password</Label><Input id="np" type="password" autoComplete="new-password" className="mt-1" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div><Label htmlFor="cf">Confirm new password</Label><Input id="cf" type="password" autoComplete="new-password" className="mt-1" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        {done ? <p className="flex items-center gap-1.5 text-sm text-success"><Check className="h-4 w-4" /> Password updated.</p> : null}
        <div><Button type="submit" size="sm" disabled={busy || !current || !next || !confirm}>{busy ? 'Updating…' : 'Update password'}</Button></div>
      </form>
    </Card>
  );
}

export function ProfilePage() {
  return (
    <div>
      <PageHeader title="User Profile" description="Your account, access, and security." />
      <div className="flex flex-col gap-4">
        <ProfileCard />
        <PasswordCard />
      </div>
    </div>
  );
}
