// Offscreen document — sole purpose is to keep the service worker alive
// by maintaining an open port, and to act as a timer that pings the
// background script at the configured interval.
// This file intentionally uses ZERO chrome.storage calls.

let intervalHandle = null;
let port = null;

// Connect a port to the background — keeps service worker alive
function connectPort() {
  port = chrome.runtime.connect({ name: "keepalive" });
  port.onDisconnect.addListener(() => {
    // Reconnect if disconnected
    setTimeout(connectPort, 1000);
  });
  port.onMessage.addListener((msg) => {
    if (msg.type === "startTimer") {
      startTimer(msg.seconds);
    }
    if (msg.type === "stopTimer") {
      stopTimer();
    }
  });
}

function startTimer(seconds) {
  stopTimer();
  console.log(`[TruthAlert] Offscreen timer: tick every ${seconds}s`);
  // Immediate tick
  port.postMessage({ type: "tick" });
  intervalHandle = setInterval(() => {
    try {
      port.postMessage({ type: "tick" });
    } catch {
      // Port disconnected, reconnect
      connectPort();
    }
  }, seconds * 1000);
}

function stopTimer() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

// Start
connectPort();
