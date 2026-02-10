import React, { useState } from "react";
import { generatePrivateKey, getPublicKey, nip19 } from "nostr-tools";

interface LoginProps {
  onLogin: (privateKey: string, initialNickname?: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [inputKey, setInputKey] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [nickname, setNickname] = useState("");
  const [formError, setFormError] = useState("");
  const [copyState, setCopyState] = useState<"public" | "private" | "">("");
  const [generatedKeys, setGeneratedKeys] = useState({
    privateKey: "",
    publicKey: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (inputKey) {
      try {
        const decodedKey = nip19.decode(inputKey);
        onLogin(decodedKey.data as string);
      } catch (error) {
        setFormError("Clave privada no válida. Usa un formato nsec correcto.");
      }
    } else {
      const newPrivateKey = generatePrivateKey();
      const newPublicKey = getPublicKey(newPrivateKey);
      setGeneratedKeys({
        privateKey: nip19.nsecEncode(newPrivateKey),
        publicKey: nip19.npubEncode(newPublicKey),
      });
      setNickname("");
      setShowPopup(true);
    }
  };

  const handleClosePopup = () => {
    setShowPopup(false);
    setCopyState("");
    const nick = nickname.trim();
    onLogin(nip19.decode(generatedKeys.privateKey).data as string, nick || undefined);
  };

  const handleCopy = async (type: "public" | "private") => {
    const value = type === "public" ? generatedKeys.publicKey : generatedKeys.privateKey;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(type);
      setTimeout(() => setCopyState(""), 1200);
    } catch {
      setCopyState("");
    }
  };

  return (
    <div className="home-shell">
      <div className="home-orb home-orb-a" aria-hidden />
      <div className="home-orb home-orb-b" aria-hidden />

      <section className="home-hero animate-fade-in">
        <p className="home-badge">Nostr protocol • Self-custody chat</p>
        <h2 className="home-title">NostrDome</h2>
        <p className="home-subtitle">
          Mensajería privada y canales públicos, en una experiencia enfocada en soberanía digital.
        </p>
        <div className="home-pill-grid">
          <span className="home-pill">Relays abiertos</span>
          <span className="home-pill">Identidad propia</span>
          <span className="home-pill">Sin servidor central</span>
        </div>
      </section>

      <section className="home-card animate-fade-in" aria-label="Acceso a NostrDome">
        <h3 className="home-card-title">Entrar al Dome</h3>
        <p className="home-card-copy">
          Pega tu clave privada `nsec` para iniciar sesión o genera una nueva identidad.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder="nsec1..."
            className="home-input"
          />
          {formError && <p className="home-error">{formError}</p>}
          <button type="submit" className="home-cta">
            {inputKey ? "Iniciar sesión" : "Generar nueva clave"}
          </button>
        </form>

        <p className="home-footnote">
          NostrDome guarda tu clave solo en este navegador para mantener tu sesión.
        </p>
      </section>

      {showPopup && (
        <div className="home-modal-overlay">
          <div className="home-modal-card animate-fade-in">
            <h2 className="home-modal-title">Tus nuevas claves Nostr</h2>
            <p className="home-modal-copy">
              Guarda estas claves en un lugar seguro. Sin tu `nsec`, no podrás volver a entrar a esta identidad.
            </p>
            <div className="home-key-wrap">
              <p className="home-key-label">Clave pública</p>
              <p className="home-key-value">{generatedKeys.publicKey}</p>
              <button type="button" onClick={() => handleCopy("public")} className="home-key-copy">
                {copyState === "public" ? "Copiada" : "Copiar"}
              </button>
            </div>
            <div className="home-key-wrap">
              <p className="home-key-label">Clave privada</p>
              <p className="home-key-value">{generatedKeys.privateKey}</p>
              <button type="button" onClick={() => handleCopy("private")} className="home-key-copy home-key-copy-warn">
                {copyState === "private" ? "Copiada" : "Copiar"}
              </button>
            </div>
            <div className="mb-5">
              <label htmlFor="new-keys-nickname" className="block text-sm font-medium text-gray-300 mb-1">
                Tu nombre o nickname (opcional)
              </label>
              <input
                id="new-keys-nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="ej. alice"
                className="home-input"
              />
            </div>
            <button
              type="button"
              onClick={handleClosePopup}
              className="home-cta"
            >
              Ya guardé mis claves
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
