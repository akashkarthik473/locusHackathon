import React, { useState } from "react";

function App() {
  const [response, setResponse] = useState("");

  const handleButtonClick = async () => {
    try {
      const res = await fetch("http://localhost:5000/joke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();
      setResponse(data.message || "Payment processed!");
    } catch (error) {
      setResponse("Error: " + error.message);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        width: "100vw",
        margin: 0,
        padding: 0,
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "48px", marginBottom: "30px" }}>Pay for Joke!</h1>
      <button
        onClick={handleButtonClick}
        style={{
          padding: "15px 30px",
          fontSize: "20px",
          cursor: "pointer",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "5px",
        }}
      >
        Press Me!
      </button>
      {response && <p style={{ marginTop: "20px" }}>{response}</p>}
    </div>
  );
}

export default App;