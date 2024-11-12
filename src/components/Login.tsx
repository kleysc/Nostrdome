import React, { useState } from "react";
import { generatePrivateKey, getPublicKey, nip19 } from "nostr-tools";

interface LoginProps {
  onLogin: (privateKey: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [inputKey, setInputKey] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [generatedKeys, setGeneratedKeys] = useState({
    privateKey: "",
    publicKey: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputKey) {
      try {
        const decodedKey = nip19.decode(inputKey);
        onLogin(decodedKey.data as string);
      } catch (error) {
        alert("Clave privada no válida. Por favor, inténtalo de nuevo.");
      }
    } else {
      const newPrivateKey = generatePrivateKey();
      const newPublicKey = getPublicKey(newPrivateKey);
      setGeneratedKeys({
        privateKey: nip19.nsecEncode(newPrivateKey),
        publicKey: nip19.npubEncode(newPublicKey),
      });
      setShowPopup(true);
    }
  };

  const handleClosePopup = () => {
    setShowPopup(false);
    onLogin(nip19.decode(generatedKeys.privateKey).data as string);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          placeholder="Enter your private key (optional)"
          className="w-full bg-gray-800 text-green-500 p-2 rounded focus:outline-none"
        />
        <button
          type="submit"
          className="w-full bg-green-700 text-white px-4 py-2 rounded hover:bg-green-600"
        >
          {inputKey ? "Login" : "Generate New Key"}
        </button>
      </form>

      {showPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full">
            <h2 className="text-xl mb-4">Your New Keys</h2>
            <p className="mb-2">
              <strong>Public Key:</strong> <br />
              <span className="break-all">{generatedKeys.publicKey}</span>
            </p>
            <p className="mb-4">
              <strong>Private Key:</strong> <br />
              <span className="break-all">{generatedKeys.privateKey}</span>
            </p>
            <p className="mb-4 text-yellow-400">
              Important: Save these keys securely. You'll need the private key
              to log in next time.
            </p>
            <button
              onClick={handleClosePopup}
              className="w-full bg-green-700 text-white px-4 py-2 rounded hover:bg-green-600"
            >
              I've Saved My Keys
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;