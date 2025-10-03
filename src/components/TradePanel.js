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

  const [tradeType, setTradeType] = useState("RANDOM");
  const [digitBarrier, setDigitBarrier] = useState("AUTO");

  const tickBuffers = useRef({});
  const lastTradeTime = useRef(0);
  const signalConfirm = useRef({});

  const COOLDOWN_MS = 2500;
  const PROB_THRESHOLD = 10;
  const SIDE_SUM_THRESHOLD = 55;
  const CONFIRM_COUNT = 2;
  const STREAK_LENGTH = 3;

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
    if (!history || history.length === 0) return Array(10).fill(0);
    let counts = Array(10).fill(0);
    history.forEach((price) => {
      const d = parseInt(price.toString().slice(-1), 10);
      if (!Number.isNaN(d)) counts[d]++;
    });
    return counts.map((c) => (c / history.length) * 100);
  }, []);

  const confirmSignal = (symbol, type) => {
    if (!signalConfirm.current[symbol]) signalConfirm.current[symbol] = {};
    const s = signalConfirm.current[symbol];
    s[type] = (s[type] || 0) + 1;
    return s[type] >= CONFIRM_COUNT;
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

      // Map Rise/Fall to CALL/PUT for Deriv
      let apiContractType = contract_type;
      if (contract_type === "RISE") apiContractType = "CALL";
      else if (contract_type === "FALL") apiContractType = "PUT";

      addLog(
        `🚀 Placing ${contract_type} on ${symbol} (barrier ${
          barrier ?? "AUTO"
        }, stake $${stake})`
      );
      updateStatus(
        `🚀 Trading ${contract_type} on ${symbol} (barrier ${barrier ?? "AUTO"})`
      );
      setIsTradeActive(true);
      lastTradeTime.current = now;

      const tradeRequest = {
        buy: 1,
        price: Number(stake),
        parameters: {
          amount: Number(stake),
          basis: "stake",
          contract_type: apiContractType,
          currency: "USD",
          duration: 1,
          duration_unit: "t",
          symbol,
          barrier: barrier !== undefined ? barrier.toString() : undefined,
        },
      };
      ws.send(JSON.stringify(tradeRequest));
    },
    [ws, stake, isTradeActive, addLog, updateStatus]
  );

  const subscribeTicks = useCallback(() => {
    const indices =
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
    try {
      ws.send(JSON.stringify({ forget_all: "ticks" }));
    } catch (e) {}
    tickBuffers.current = {};
    signalConfirm.current = {};
  }, [ws]);

  const handleStop = useCallback(() => {
    setRunning(false);
    setIsTradeActive(false);
    setActiveSymbol(null);
    unsubscribeTicks();
    setStatus("Stopped ❌");
    addLog("Bot stopped manually");
  }, [unsubscribeTicks, addLog]);

  const parityStreak = (digitsArray, parity) => {
    if (!digitsArray || digitsArray.length < STREAK_LENGTH) return false;
    const arr = digitsArray.slice(-STREAK_LENGTH);
    return arr.every((d) => d % 2 === parity);
  };

  const digitsFromHistory = (history) =>
    history
      .map((p) => {
        const d = parseInt(p.toString().slice(-1), 10);
        return Number.isNaN(d) ? null : d;
      })
      .filter((d) => d !== null);

  const chooseAutoOverBarrier = (probs, lastDigit) => {
    const allowed = [1, 2, 3];
    for (const d of allowed) {
      const lowSet = [...Array(d + 1).keys()];
      const allLow = lowSet.every((ld) => probs[ld] < PROB_THRESHOLD);
      if (!allLow) continue;
      if (lastDigit !== null && lowSet.includes(lastDigit)) return d;
    }
    return null;
  };

  const chooseAutoUnderBarrier = (probs, lastDigit) => {
    const allowed = [6, 7, 8];
    for (const d of allowed) {
      const highSet = [];
      for (let x = d; x <= 9; x++) highSet.push(x);
      const allLow = highSet.every((hd) => probs[hd] < PROB_THRESHOLD);
      if (!allLow) continue;
      if (lastDigit !== null && highSet.includes(lastDigit)) return d;
    }
    return null;
  };

  const decideTradeAuto = useCallback((probs, lastDigitsArr) => {
    const evenProb = probs[0] + probs[2] + probs[4] + probs[6] + probs[8];
    const oddProb = 100 - evenProb;

    if (evenProb > 60) return { type: "DIGITEVEN" };
    if (oddProb > 60) return { type: "DIGITODD" };

    if (probs.some((p) => p < PROB_THRESHOLD)) {
      const barrier = probs.indexOf(Math.min(...probs));
      return { type: "DIGITDIFF", barrier };
    }

    if (
      lastDigitsArr.length >= 3 &&
      lastDigitsArr[lastDigitsArr.length - 1] >
        lastDigitsArr[lastDigitsArr.length - 2] &&
      lastDigitsArr[lastDigitsArr.length - 2] >
        lastDigitsArr[lastDigitsArr.length - 3]
    )
      return { type: "RISE" };

    if (
      lastDigitsArr.length >= 3 &&
      lastDigitsArr[lastDigitsArr.length - 1] <
        lastDigitsArr[lastDigitsArr.length - 2] &&
      lastDigitsArr[lastDigitsArr.length - 2] <
        lastDigitsArr[lastDigitsArr.length - 3]
    )
      return { type: "FALL" };

    return null;
  }, []);

  const findNextSymbolWithSignal = useCallback(() => {
    for (const symbol in tickBuffers.current) {
      const history = tickBuffers.current[symbol];
      if (!history || history.length < 10) continue;

      const probs = analyzeDigits(history);
      const digits = digitsFromHistory(history);
      const lastDigit = digits.length ? digits[digits.length - 1] : null;

      let chosen = null;

      if (tradeType === "RANDOM") {
        chosen = decideTradeAuto(probs, digits);
      } else if (tradeType === "OVER") {
        const barrierToUse =
          digitBarrier === "AUTO"
            ? chooseAutoOverBarrier(probs, lastDigit)
            : Number(digitBarrier);
        if (barrierToUse !== null && barrierToUse !== undefined) {
          const upperSum = probs
            .slice(barrierToUse + 1)
            .reduce((a, b) => a + b, 0);
          if (
            upperSum >= SIDE_SUM_THRESHOLD &&
            confirmSignal(symbol, `OVER${barrierToUse}`)
          ) {
            chosen = { type: "DIGITOVER", barrier: barrierToUse };
          }
        }
      } else if (tradeType === "UNDER") {
        const barrierToUse =
          digitBarrier === "AUTO"
            ? chooseAutoUnderBarrier(probs, lastDigit)
            : Number(digitBarrier);
        if (barrierToUse !== null && barrierToUse !== undefined) {
          const lowerSum = probs
            .slice(0, barrierToUse + 1)
            .reduce((a, b) => a + b, 0);
          if (
            lowerSum >= SIDE_SUM_THRESHOLD &&
            confirmSignal(symbol, `UNDER${barrierToUse}`)
          ) {
            chosen = { type: "DIGITUNDER", barrier: barrierToUse };
          }
        }
      } else if (tradeType === "DIFFERS") {
        const barrierToUse =
          digitBarrier === "AUTO"
            ? probs.indexOf(Math.min(...probs))
            : Number(digitBarrier);
        if (
          probs[barrierToUse] < PROB_THRESHOLD &&
          confirmSignal(symbol, `DIFF${barrierToUse}`)
        ) {
          chosen = { type: "DIGITDIFF", barrier: barrierToUse };
        }
      } else if (tradeType === "EVENODD") {
        const evenProb =
          probs[0] + probs[2] + probs[4] + probs[6] + probs[8];
        const oddProb = 100 - evenProb;
        if (evenProb > SIDE_SUM_THRESHOLD) {
          if (
            digits.length >= STREAK_LENGTH &&
            parityStreak(digits, 1) &&
            confirmSignal(symbol, "EVEN")
          ) {
            chosen = { type: "DIGITEVEN" };
          }
        } else if (oddProb > SIDE_SUM_THRESHOLD) {
          if (
            digits.length >= STREAK_LENGTH &&
            parityStreak(digits, 0) &&
            confirmSignal(symbol, "ODD")
          ) {
            chosen = { type: "DIGITODD" };
          }
        }
      } else if (tradeType === "RISEFALL") {
        if (
          digits.length >= 3 &&
          digits[digits.length - 1] > digits[digits.length - 2] &&
          digits[digits.length - 2] > digits[digits.length - 3] &&
          confirmSignal(symbol, "RISE")
        ) {
          chosen = { type: "RISE" };
        } else if (
          digits.length >= 3 &&
          digits[digits.length - 1] < digits[digits.length - 2] &&
          digits[digits.length - 2] < digits[digits.length - 3] &&
          confirmSignal(symbol, "FALL")
        ) {
          chosen = { type: "FALL" };
        }
      }

      if (chosen) {
        return {
          symbol,
          contract_type: chosen.type,
          barrier: chosen.barrier,
        };
      }
    }

    return null;
  }, [tradeType, digitBarrier, analyzeDigits, decideTradeAuto]);

  useEffect(() => {
    if (!ws) return;
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ ping: 1 }));
    }, 30000);

    const handleMessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.msg_type === "tick" && running) {
          const symbol = data.tick.symbol;
          const price = data.tick.quote;

          if (!tickBuffers.current[symbol]) tickBuffers.current[symbol] = [];
          tickBuffers.current[symbol].push(price);
          if (tickBuffers.current[symbol].length > 50)
            tickBuffers.current[symbol].shift();

          if (!isTradeActive) {
            const candidate = findNextSymbolWithSignal();
            if (candidate) {
              setActiveSymbol(candidate.symbol);
              updateStatus(
                `🔒 Locked on ${candidate.symbol} (${candidate.contract_type})`
              );
              addLog(
                `Locked on ${candidate.symbol} for ${candidate.contract_type} (barrier ${
                  candidate.barrier ?? "AUTO"
                })`
              );
              placeTrade(
                candidate.symbol,
                candidate.contract_type,
                candidate.barrier
              );
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
            setActiveSymbol(null);
          }
        }

        if (data.msg_type === "proposal_open_contract") {
          if (data.proposal_open_contract.is_sold) {
            const profit = data.proposal_open_contract.profit || 0;
            const result = profit > 0 ? "✅ Won" : "❌ Lost";
            addLog(
              `📉 Contract closed: ${result}, Profit: $${profit.toFixed(2)}`
            );
            updateStatus(`📉 Last result: ${result}`);
            setIsTradeActive(false);
            setActiveSymbol(null);

            setPlTracker((prev) => {
              const newPl = prev + profit;
              if (tp && newPl >= Number(tp)) {
                updateStatus("✅ Take Profit reached");
                addLog("✅ Take Profit reached, stopping bot");
                handleStop();
              } else if (sl && newPl <= -Number(sl)) {
                updateStatus("❌ Stop Loss reached");
                addLog("❌ Stop Loss reached, stopping bot");
                handleStop();
              }
              return newPl;
            });
          }
        }
      } catch (e) {}
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
    findNextSymbolWithSignal,
    isTradeActive,
    updateStatus,
    handleStop,
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

  return (
    <div className="trade-box">
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
      <p>P/L Tracker: ${plTracker.toFixed(2)}</p>
      <p>Active Symbol: {activeSymbol ? activeSymbol : "None"}</p>

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

      <label>Choose Trade Type:</label>
      <select
        value={tradeType}
        onChange={(e) => setTradeType(e.target.value)}
      >
        <option value="RANDOM">Auto</option>
        <option value="OVER">Over</option>
        <option value="UNDER">Under</option>
        <option value="DIFFERS">Differs</option>
        <option value="EVENODD">Even / Odd</option>
        <option value="RISEFALL">Rise / Fall</option>
      </select>

      {(tradeType === "OVER" ||
        tradeType === "UNDER" ||
        tradeType === "DIFFERS") && (
        <>
          <label>Select Digit:</label>
          <select
            value={digitBarrier}
            onChange={(e) =>
              setDigitBarrier(
                e.target.value === "AUTO" ? "AUTO" : Number(e.target.value)
              )
            }
          >
            <option value="AUTO">AUTO</option>
            {[...Array(10).keys()].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </>
      )}

      <label>Stake ($):</label>
      <input
        type="number"
        min="0.35"
        step="0.01"
        value={stake}
        onChange={(e) => setStake(e.target.value)}
      />

      <label>Take Profit ($):</label>
      <input
        type="number"
        value={tp}
        onChange={(e) => setTp(e.target.value)}
      />

      <label>Stop Loss ($):</label>
      <input
        type="number"
        value={sl}
        onChange={(e) => setSl(e.target.value)}
      />

      <div className="trade-buttons">
        <button
          className={`bot-btn ${running ? "stop" : "start"}`}
          onClick={running ? handleStop : handleStart}
        >
          {running ? "⏹ Stop Bot" : "▶️ Start Bot"}
        </button>
      </div>

      {/* Status now handles logs */}
      <Status status={status} logs={logs} />
    </div>
  );
};

export default TradePanel;
