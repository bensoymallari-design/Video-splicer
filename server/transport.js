import net from "node:net";
import dgram from "node:dgram";
import { TCP_PORT, UDP_PORT, parsePacket } from "./protocol.js";

const CONNECT_TIMEOUT_MS = 2500;
const COMMAND_TIMEOUT_MS = 1500;

export function sendTcp(host, port, packet, { timeout = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout });
    let buf = Buffer.alloc(0);
    let settled = false;

    const finish = (err, reply) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(reply);
    };

    socket.setNoDelay(true);
    socket.once("connect", () => socket.write(packet));
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const parsed = parsePacket(buf);
      if (parsed) finish(null, { ok: parsed.validChecksum, parsed, raw: buf });
    });
    socket.once("timeout", () => finish(new Error("timeout")));
    socket.once("error", (err) => finish(err));
    socket.once("close", () => {
      if (!settled) {
        if (buf.length) {
          const parsed = parsePacket(buf);
          finish(null, { ok: Boolean(parsed?.validChecksum), parsed, raw: buf });
        } else {
          // Some sending cards apply writes without an ACK.
          finish(null, { ok: true, parsed: null, raw: Buffer.alloc(0), assumed: true });
        }
      }
    });
    setTimeout(() => finish(new Error("timeout")), timeout);
  });
}

export function sendUdp(host, port, packet, { timeout = 800 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      resolve({ ok: true, parsed: null, raw: Buffer.alloc(0), assumed: true });
    }, timeout);
    socket.once("error", (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
    socket.send(packet, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
    socket.on("message", (msg) => {
      clearTimeout(timer);
      socket.close();
      const parsed = parsePacket(msg);
      resolve({ ok: Boolean(parsed?.validChecksum), parsed, raw: msg });
    });
  });
}

export function probeTcp(host, port = TCP_PORT, timeout = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeout);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function sendCommand(host, port, packet, transport = "tcp") {
  if (transport === "udp") {
    return sendUdp(host, port || UDP_PORT, packet);
  }
  return sendTcp(host, port || TCP_PORT, packet);
}
