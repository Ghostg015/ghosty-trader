import React, { useState, useRef } from "react";
import "../styles/connection.css";

const Connection = ({ onConnect }) => {
  const [apiToken, setApiToken] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [balance, setBalance] = useState(null);

  const wsRef = useRef(null);
  const pingIntervalRef = useRef(null);

  const startPing = () => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

    // Send ping every 30s
    pingIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ ping: 1 }));
      }
    }, 30000);
  };

  const stopPing = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  };

  const connectWS = () => {
    const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("Authorizing...");
      ws.send(JSON.stringify({ authorize: apiToken }));
      startPing();
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.error) {
        setStatus("Error: " + data.error.message);
        console.error("Deriv Error:", data.error);
      }

      if (data.msg_type === "authorize") {
        setStatus("Connected ✅");
        ws.send(JSON.stringify({ balance: 1 })); // request balance
      }

      if (data.msg_type === "balance" && data.balance) {
        setBalance(data.balance.balance);
        onConnect(ws, data.balance.balance);
      }
    };

    ws.onclose = () => {
      setStatus("Disconnected ❌ (reconnecting...)");
      stopPing();
      // Auto-reconnect after 3s
      setTimeout(() => {
        if (apiToken) connectWS();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error("WS Error:", err);
      ws.close();
    };
  };

  const handleConnect = () => {
    if (!apiToken) {
      alert("Please enter your API token");
      return;
    }
    connectWS();
  };

  return (
    <div className="connection-box">
      <h2>🔗 Connect to Deriv</h2>
      <input
        type="password"
        placeholder="Enter your API Token"
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
