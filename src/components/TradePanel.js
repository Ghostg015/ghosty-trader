import React, { useState, useEffect, useRef, useCallback } from "react";
import Status from "./Status";
import "../styles/tradepanel.css";

const TradePanel = ({ ws, balance }) => {
  const [volatility, setVolatility] = useState("all");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [stake, setStake] = useState("0.35");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("Idle");

  const [isTradeActive, setIsTradeActive] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState(null);
  const [plTracker, setPlTracker] = useState(0);

  const tickBuffers = useRef({});
  const lastTradeTime = useRef(0);
  const signalConfirm = useRef({});

  const COOLDOWN_MS = 2500;

  const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const addLog = useCallback(
    (msg) =>
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] ${msg}`,
      ]),
    []
  );

  const updateStatus = useCallback((msg) => setStatus(msg), []);

  const analyzeDigits = useCallback((history) => {
    let counts = Array(10).fill(0);
    history.forEach((price) => {
      const digit = parseInt(price.toString().slice(-1));
      counts[digit]++;
    });
    return counts.map((c) => (c / history.length) * 100);
  }, []);

  const confirmSignal = (symbol, type) => {
    if (!signalConfirm.current[symbol]) signalConfirm.current[symbol] = {};
    const s = signalConfirm.current[symbol];
    s[type] = (s[type] || 0) + 1;
    return s[type] >= 2;
  };

  const placeTrade = useCallback(
    (symbol, contract_type, barrier) => {
      const now = Date.now();
      if (now - lastTradeTime.current < COOLDOWN_MS) {
        addLog("⏳ Cooldown active, skipping trade...");
        return;
      }
      if (isTradeActive) {
        addLog("⚠️ Waiting for previous trade to finish...");
        return;
      }
      addLog(
        `🚀 Placing ${contract_type} on ${symbol} (barrier ${barrier}, stake $${stake})`
      );
      updateStatus(`🚀 Trading ${contract_type} on ${symbol} (barrier ${barrier})`);
      setIsTradeActive(true);
      lastTradeTime.current = now;

      const tradeRequest = {
        buy: 1,
        price: Number(stake),
        parameters: {
          amount: Number(stake),
          basis: "stake",
          contract_type,
          currency: "USD",
          duration: 1,
          duration_unit: "t",
          symbol,
          barrier: barrier.toString(),
        },
      };
      ws.send(JSON.stringify(tradeRequest));
    },
    [ws, stake, isTradeActive, addLog, updateStatus]
  );

  const subscribeTicks = useCallback(() => {
    let indices =
      volatility === "all"
        ? [
            "R_10",
            "R_25",
            "R_50",
            "R_75",
            "R_100",
            "1HZ10V",
            "1HZ25V",
            "1HZ50V",
            "1HZ75V",
            "1HZ100V",
          ]
        : [volatility];
    indices.forEach((symbol) => {
      tickBuffers.current[symbol] = [];
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    });
  }, [volatility, ws]);

  const unsubscribeTicks = useCallback(() => {
    ws.send(JSON.stringify({ forget_all: "ticks" }));
    tickBuffers.current = {};
    signalConfirm.current = {};
  }, [ws]);

  const getLeastDigit = (probs) => {
    const min = Math.min(...probs);
    return probs.indexOf(min);
  };

  const findNextSymbolWithSignal = useCallback(() => {
    for (const symbol in tickBuffers.current) {
      if (tickBuffers.current[symbol].length >= 10) {
        const probs = analyzeDigits(tickBuffers.current[symbol]);
        const maxProb = Math.max(...probs);

        // Over
        if (maxProb >= 15 && (probs[0] < 10 || probs[1] < 10 || probs[2] < 10)) {
          const barrier = randomPick([0, 1, 2]);
          if (confirmSignal(symbol, `DIGITOVER${barrier}`))
            return { symbol, contract_type: "DIGITOVER", barrier };
        }
        // Under
        if (maxProb >= 15 && (probs[7] < 10 || probs[8] < 10 || probs[9] < 10)) {
          const barrier = randomPick([7, 8, 9]);
          if (confirmSignal(symbol, `DIGITUNDER${barrier}`))
            return { symbol, contract_type: "DIGITUNDER", barrier };
        }
        // Differs
        const least = getLeastDigit(probs);
        if (probs[least] < 10) {
          if (confirmSignal(symbol, `DIGITDIFF${least}`))
            return { symbol, contract_type: "DIGITDIFF", barrier: least };
        }
      }
    }
    return null;
  }, [analyzeDigits]);

  useEffect(() => {
    if (!ws) return;
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: 1 }));
    }, 30000);

    const handleMessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.msg_type === "tick" && running) {
        const symbol = data.tick.symbol;
        const price = data.tick.quote;
        if (!tickBuffers.current[symbol]) tickBuffers.current[symbol] = [];
        tickBuffers.current[symbol].push(price);
        if (tickBuffers.current[symbol].length > 20)
          tickBuffers.current[symbol].shift();

        if (tickBuffers.current[symbol].length >= 10) {
          const probs = analyzeDigits(tickBuffers.current[symbol]);
          const maxProb = Math.max(...probs);

          if (activeSymbol === symbol && !isTradeActive) {
            if (
              maxProb >= 15 &&
              (probs[0] < 10 || probs[1] < 10 || probs[2] < 10)
            ) {
              const barrier = randomPick([0, 1, 2]);
              if (confirmSignal(symbol, `DIGITOVER${barrier}`))
                placeTrade(symbol, "DIGITOVER", barrier);
            } else if (
              maxProb >= 15 &&
              (probs[7] < 10 || probs[8] < 10 || probs[9] < 10)
            ) {
              const barrier = randomPick([7, 8, 9]);
              if (confirmSignal(symbol, `DIGITUNDER${barrier}`))
                placeTrade(symbol, "DIGITUNDER", barrier);
            } else {
              const least = getLeastDigit(probs);
              if (probs[least] < 10 && confirmSignal(symbol, `DIGITDIFF${least}`))
                placeTrade(symbol, "DIGITDIFF", least);
              else {
                addLog(`🔓 Unlocking ${activeSymbol}, condition gone`);
                updateStatus(`🔓 Unlocked ${activeSymbol}`);
                setActiveSymbol(null);
              }
            }
          }

          if (!activeSymbol && !isTradeActive) {
            const candidate = findNextSymbolWithSignal();
            if (candidate) {
              setActiveSymbol(candidate.symbol);
              updateStatus(
                `🔒 Locked on ${candidate.symbol} (${candidate.contract_type})`
              );
              addLog(`Locked on ${candidate.symbol} for ${candidate.contract_type}`);
              placeTrade(candidate.symbol, candidate.contract_type, candidate.barrier);
            }
          }
        }
      }

      if (data.msg_type === "buy") {
        if (data.buy && data.buy.contract_id) {
          addLog(`📑 Trade placed → ID: ${data.buy.contract_id}`);
          ws.send(
            JSON.stringify({
              proposal_open_contract: 1,
              contract_id: data.buy.contract_id,
              subscribe: 1,
            })
          );
        } else if (data.error) {
          addLog(`❌ Trade error: ${data.error.message}`);
          updateStatus(`❌ Trade error`);
          setIsTradeActive(false);
        }
      }

      if (data.msg_type === "proposal_open_contract") {
        if (data.proposal_open_contract.is_sold) {
          const profit = data.proposal_open_contract.profit || 0;
          const result = profit > 0 ? "✅ Won" : "❌ Lost";
          addLog(`📉 Contract closed: ${result}, Profit: $${profit.toFixed(2)}`);
          updateStatus(`📉 Last result: ${result}`);
          setIsTradeActive(false);

          setPlTracker((prev) => {
            const newPl = prev + profit;
            if (tp && newPl >= Number(tp)) {
              updateStatus("✅ Take Profit reached");
              addLog("✅ Take Profit reached, stopping bot");
              setRunning(false);
              setActiveSymbol(null);
              unsubscribeTicks();
            } else if (sl && newPl <= -Number(sl)) {
              updateStatus("❌ Stop Loss reached");
              addLog("❌ Stop Loss reached, stopping bot");
              setRunning(false);
              setActiveSymbol(null);
              unsubscribeTicks();
            }
            return newPl;
          });
        }
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => {
      clearInterval(pingInterval);
      ws.removeEventListener("message", handleMessage);
    };
  }, [
    ws,
    running,
    tp,
    sl,
    placeTrade,
    unsubscribeTicks,
    addLog,
    analyzeDigits,
    activeSymbol,
    findNextSymbolWithSignal,
    isTradeActive,
    updateStatus,
  ]);

  const handleStart = () => {
    if (!tp || !sl) {
      alert("Enter both Take Profit and Stop Loss!");
      return;
    }
    setPlTracker(0);
    setRunning(true);
    setStatus("Analyzing...");
    addLog("Bot started ✅");
    subscribeTicks();
  };

  const handleStop = () => {
    setRunning(false);
    setIsTradeActive(false);
    setActiveSymbol(null);
    unsubscribeTicks();
    setStatus("Stopped ❌");
    addLog("Bot stopped manually");
  };

  return (
    <div className="trade-box">
      {/* Strict warning banner */}
      <div className="warning-box">
        ⚠️ <strong>Risk Warning:</strong> This bot makes automated trades on your
        Deriv account using your API token. Trading involves financial risk.
        Test with a demo account first. You are responsible for all results.
      </div>

      <h2>⚡ Trading Panel</h2>
      <p>
        Balance:{" "}
        {balance !== null && balance !== undefined
          ? `$${Number(balance).toFixed(2)}`
          : "Loading..."}
      </p>
      <p>
        P/L Tracker: $
        {plTracker !== null && plTracker !== undefined
          ? plTracker.toFixed(2)
          : "0.00"}
      </p>

      <label>Choose Volatility:</label>
      <select
        value={volatility}
        onChange={(e) => setVolatility(e.target.value)}
      >
        <option value="all">All Volatilities</option>
        <option value="R_10">Volatility 10 Index</option>
        <option value="R_25">Volatility 25 Index</option>
        <option value="R_50">Volatility 50 Index</option>
        <option value="R_75">Volatility 75 Index</option>
        <option value="R_100">Volatility 100 Index</option>
        <option value="1HZ10V">Volatility 1s Index 10</option>
        <option value="1HZ25V">Volatility 1s Index 25</option>
        <option value="1HZ50V">Volatility 1s Index 50</option>
        <option value="1HZ75V">Volatility 1s Index 75</option>
        <option value="1HZ100V">Volatility 1s Index 100</option>
      </select>

      <label>Stake ($):</label>
      <input
        type="number"
        min="0.35"
        step="0.01"
        value={stake}
        onChange={(e) => setStake(e.target.value)}
      />

      <label>Take Profit ($):</label>
      <input type="number" value={tp} onChange={(e) => setTp(e.target.value)} />

      <label>Stop Loss ($):</label>
      <input type="number" value={sl} onChange={(e) => setSl(e.target.value)} />

      {!running ? (
        <button className="start-btn" onClick={handleStart}>
          ▶ Run
        </button>
      ) : (
        <button className="stop-btn" onClick={handleStop}>
          ⏹ Stop
        </button>
      )}

      <Status status={status} logs={logs} />
    </div>
  );
};

export default TradePanel;
