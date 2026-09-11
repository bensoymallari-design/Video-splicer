import net from "node:net";
import { makeAck, parsePacket, REG } from "./protocol.js";

/**
 * In-process NovaStar controller that speaks TCP 5200.
 * Used so the laptop app can be developed and demonstrated without hardware.
 */
export function createSimulator({ host = "127.0.0.1", port, name, model }) {
  const state = {
    name,
    model,
    brightness: 204,
    display: "normal",
    freeze: false,
    preset: 1,
    lowLatency: false,
    mode3d: false,
    eye3d: "right",
    controllerMode: "send-only",
    input: { card: 0, iface: 0 },
    lastRegister: null,
    packets: 0,
  };

  function apply(parsed) {
    state.lastRegister = parsed.register;
    state.packets += 1;
    const d = parsed.data;
    switch (parsed.register) {
      case REG.BRIGHTNESS:
        if (d.length) state.brightness = d[0];
        break;
      case REG.DISPLAY_MODE:
        state.display = d[0] === 0xff ? "blackout" : "normal";
        if (state.display === "normal") state.freeze = false;
        break;
      case REG.FREEZE:
        state.freeze = d[0] === 0xff;
        if (state.freeze) state.display = "freeze";
        else if (state.display === "freeze") state.display = "normal";
        break;
      case REG.PRESET:
        if (d.length) state.preset = d[0];
        break;
      case REG.LOW_LATENCY:
        state.lowLatency = d[0] === 0x01;
        break;
      case REG.MODE_3D:
        state.mode3d = d[0] === 0x01;
        break;
      case REG.EYE_3D:
        state.eye3d = d[0] === 0x01 ? "left" : "right";
        break;
      case REG.CONTROLLER_MODE:
        state.controllerMode = d[0] === 0x01 ? "all-in-one" : "send-only";
        break;
      case REG.LAYER_SOURCE:
        if (d.length >= 3) state.input = { card: d[1], iface: d[2] };
        break;
      default:
        break;
    }
  }

  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 21) {
        const packet = buf.subarray(0, 21);
        // Variable-length packets: 21 bytes for 1-byte data, 22 for sending-card, 23 for layer.
        let size = 21;
        const maybeLen = buf.length >= 18 ? buf.readUInt16LE(16) : 1;
        size = 2 + 16 + maybeLen + 2;
        if (buf.length < size) break;
        const frame = buf.subarray(0, size);
        buf = buf.subarray(size);
        const parsed = parsePacket(frame);
        if (!parsed?.validChecksum) continue;
        apply(parsed);
        const ack = makeAck(frame);
        if (ack) socket.write(ack);
      }
    });
    socket.on("error", () => {});
  });

  const ready = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve({
        host,
        port: server.address().port,
        name,
        model,
        getState: () => ({ ...state, input: { ...state.input } }),
        close: () =>
          new Promise((res) => {
            server.close(() => res());
          }),
      });
    });
  });

  return ready;
}
