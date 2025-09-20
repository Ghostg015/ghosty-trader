import React, { useState } from "react";
import Connection from "./components/Connection";
import TradePanel from "./components/TradePanel";
import "./styles/App.css";

function App() {
  const [ws, setWs] = useState(null);
  const [balance, setBalance] = useState(null);

  const handleConnect = (websocket, userBalance) => {
    setWs(websocket);
    setBalance(userBalance);
  };

  return (
    <div className="App">
      <h1>👻 Ghosty Trader</h1>

      {/* Connect to Deriv */}
      <Connection onConnect={handleConnect} />

      {ws && <TradePanel ws={ws} balance={balance} />}
    </div>
  );
}

export default App;
