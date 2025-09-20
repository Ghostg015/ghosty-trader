import React, { useState, useRef } from "react";
import "../styles/connection.css";

const Connection = ({ onConnect }) => {
  const [apiToken, setApiToken] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [balance, setBalance] = useState(null);

  const wsRef = useRef(null);
  const pingInterval = useRef(null);

  const startPing = (ws) => {
    if (pingInterval.current) clearInterval(pingInterval.current);
    pingInterval.current = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 30000);
  };

  const connectAccount = (token) => {
    if (!token) return;

    const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: token }));
      startPing(ws);
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.error) {
        setStatus(`Error: ${data.error.message}`);
        console.error("Deriv Error:", data.error);
      }

      if (data.msg_type === "authorize") {
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
      }

      if (data.msg_type === "balance" && data.balance) {
        setBalance(data.balance.balance);
        setStatus("Connected ✅");
        onConnect(ws, data.balance.balance);
      }
    };

    ws.onclose = () => {
      setStatus("Disconnected ❌ (auto-reconnect in 3s)");
      setTimeout(() => {
        if (token) connectAccount(token);
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error("WS Error:", err);
      ws.close();
    };
  };

  const handleConnect = () => {
    if (!apiToken) {
      alert("API Token is required");
      return;
    }
    setStatus("Connecting...");
    connectAccount(apiToken);
  };

  return (
    <div className="connection-box">
      <h2>🔗 Connect to Deriv</h2>

      <input
        type="password"
        placeholder="Enter API Token"
        value={apiToken}
        onChange={(e) => setApiToken(e.target.value)}
      />

      <button onClick={handleConnect}>Connect</button>

      <div className="status">
        <p>Status: {status}</p>
        {balance !== null && <p>Balance: ${balance}</p>}
      </div>
    </div>
  );
};

export default Connection;
