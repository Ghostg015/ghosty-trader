import React from "react";
import "../styles/status.css";

const Status = ({ status = "Idle", logs = [] }) => {
  return (
    <div className="status-box">
      <h3>📊 Status</h3>
      <p className="current-status">{status}</p>

      <h3>📝 Logs</h3>
      <div className="logs">
        {logs.length > 0 ? (
          logs.map((log, index) => <p key={index}>{log}</p>)
        ) : (
          <p className="no-logs">No activity yet...</p>
        )}
      </div>
    </div>
  );
};
;

export default Status;
