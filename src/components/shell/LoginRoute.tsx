import { useOutletContext } from 'react-router-dom';
import Login from '../Login';
import type { RootContext } from './context';

export default function LoginRoute() {
  const ctx = useOutletContext<RootContext>();
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      <Login onLogin={ctx.onLogin} />
    </div>
  );
}
