import { usePrivy } from "@privy-io/react-auth";

function App() {
  const { ready, authenticated, login, logout } = usePrivy();

  if (!ready) {
    return <p>Loading…</p>;
  }

  return (
    <main>
      <h1>x402 × Privy</h1>
      {authenticated ? (
        <button type="button" onClick={() => logout()}>
          Log out
        </button>
      ) : (
        <button type="button" onClick={() => login()}>
          Log in
        </button>
      )}
    </main>
  );
}

export default App;
