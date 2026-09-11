/**
 * NovaStar Central Control Protocol (official V1.5.0 packet format).
 * TCP port 5200 / UDP port 5201.
 *
 * Packet: [0x55 0xAA][protocol content][checksum LE]
 * Checksum = (sum(protocol content) + 0x5555) & 0xFFFF, little-endian.
 *
 * Register map is from NovaStar Central Control Protocol Instructions V1.5.0.
 */

export const HEADER = Buffer.from([0x55, 0xaa]);
export const REPLY_HEADER = Buffer.from([0xaa, 0x55]);
export const TCP_PORT = 5200;
export const UDP_PORT = 5201;

export const REG = {
  BRIGHTNESS: 0x02000001,
  // Wire bytes from the V1.5.0 hex examples (the PDF's 0x02001000-style labels are inconsistent).
  DISPLAY_MODE: 0x02000100,
  FREEZE: 0x02000102,
  PRESET: 0x0a000002,
  LOW_LATENCY: 0x10000111,
  MODE_3D: 0x10000116,
  EYE_3D: 0x10001118,
  CONTROLLER_MODE: 0x0008fff2,
  SENDING_CARD_DISPLAY: 0x10000100,
  LAYER_SOURCE: 0x0a000003,
};

export const DISPLAY = {
  NORMAL: 0x00,
  BLACKOUT: 0xff,
};

export const FREEZE = {
  OFF: 0x00,
  ON: 0xff,
};

const PREFIX = Buffer.from([
  0x00, 0x00, 0xfe, 0xff, 0x01, 0xff, 0xff, 0xff, 0x01, 0x00,
]);

export function checksum(content) {
  let sum = 0x5555;
  for (const byte of content) sum = (sum + byte) & 0xffff;
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(sum);
  return buf;
}

export function encodeWrite(register, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const content = Buffer.alloc(PREFIX.length + 4 + 2 + payload.length);
  PREFIX.copy(content, 0);
  content.writeUInt32LE(register >>> 0, PREFIX.length);
  content.writeUInt16LE(payload.length, PREFIX.length + 4);
  payload.copy(content, PREFIX.length + 6);
  return Buffer.concat([HEADER, content, checksum(content)]);
}

export function encodeRead(register, length = 1) {
  // Same envelope; packet type 0x00 in the prefix is a write.
  // Reads keep the documented write prefix used by central-control tools.
  return encodeWrite(register, Buffer.alloc(length, 0));
}

export function setBrightness(value) {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return encodeWrite(REG.BRIGHTNESS, [v]);
}

export function setBlackout(on) {
  return encodeWrite(REG.DISPLAY_MODE, [on ? DISPLAY.BLACKOUT : DISPLAY.NORMAL]);
}

export function setFreeze(on) {
  return encodeWrite(REG.FREEZE, [on ? FREEZE.ON : FREEZE.OFF]);
}

export function setNormalDisplay() {
  return setBlackout(false);
}

export function recallPreset(index) {
  const n = Math.max(1, Math.min(26, Number(index) || 1));
  return encodeWrite(REG.PRESET, [n]);
}

export function setLowLatency(on) {
  return encodeWrite(REG.LOW_LATENCY, [on ? 0x01 : 0x00]);
}

export function set3D(on) {
  return encodeWrite(REG.MODE_3D, [on ? 0x01 : 0x00]);
}

export function set3DEye(eye) {
  return encodeWrite(REG.EYE_3D, [eye === "left" ? 0x01 : 0x00]);
}

export function setControllerMode(mode) {
  const value = mode === "all-in-one" ? 0x01 : 0x00;
  return encodeWrite(REG.CONTROLLER_MODE, [value]);
}

export function setSendingCardDisplay(card, mode) {
  const cardByte = card === "all" ? 0xff : Math.max(1, Number(card) || 1);
  const modeMap = { normal: 0x00, blackout: 0x01, freeze: 0x02 };
  return encodeWrite(REG.SENDING_CARD_DISPLAY, [cardByte, modeMap[mode] ?? 0x00]);
}

export function setLayerSource(layer, inputCard, inputInterface) {
  return encodeWrite(REG.LAYER_SOURCE, [
    Math.max(1, Number(layer) || 1),
    Number(inputCard) || 0,
    Number(inputInterface) || 0,
  ]);
}

export function parsePacket(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 21) return null;
  const isReply = buf[0] === 0xaa && buf[1] === 0x55;
  const isRequest = buf[0] === 0x55 && buf[1] === 0xaa;
  if (!isReply && !isRequest) return null;
  const content = buf.subarray(2, buf.length - 2);
  const got = buf.readUInt16LE(buf.length - 2);
  const expect = checksum(content).readUInt16LE(0);
  const register = content.readUInt32LE(10);
  const dataLength = content.readUInt16LE(14);
  const data = content.subarray(16, 16 + dataLength);
  return {
    reply: isReply,
    validChecksum: got === expect,
    register,
    dataLength,
    data: Buffer.from(data),
  };
}

export function makeAck(requestBuf) {
  const parsed = parsePacket(requestBuf);
  if (!parsed) return null;
  const content = Buffer.from(requestBuf.subarray(2, requestBuf.length - 2));
  // Swap source/destination like the documented send-only ACK.
  const src = content[2];
  const dst = content[3];
  content[2] = dst;
  content[3] = src;
  // Zero data payload for ACK as in the documented example.
  if (content.length >= 17) content[16] = 0x00;
  return Buffer.concat([REPLY_HEADER, content, checksum(content)]);
}

export function toHex(buf) {
  return Buffer.from(buf).toString("hex");
}

export const INPUTS = {
  HDMI: { card: 0, iface: 0, label: "HDMI 2.0" },
  DP: { card: 0, iface: 1, label: "DP 1.2" },
  DVI1: { card: 0, iface: 2, label: "DVI-1" },
  DVI2: { card: 0, iface: 3, label: "DVI-2" },
};

export const MODELS = {
  MCTRL4K: {
    id: "MCTRL4K",
    label: "MCTRL4K",
    maxWidth: 7680,
    maxHeight: 7680,
    maxPixels: 4096 * 2160,
    ethernetPorts: 16,
    opticalPorts: 4,
    inputs: ["HDMI", "DP", "DVI1", "DVI2"],
  },
  MX40: {
    id: "MX40",
    label: "MX40 Pro",
    maxWidth: 8192,
    maxHeight: 8192,
    maxPixels: 9_000_000,
    ethernetPorts: 20,
    opticalPorts: 4,
    inputs: ["HDMI", "DP"],
  },
  GENERIC: {
    id: "GENERIC",
    label: "NovaStar controller",
    maxWidth: 8192,
    maxHeight: 8192,
    maxPixels: 8_800_000,
    ethernetPorts: 16,
    opticalPorts: 2,
    inputs: ["HDMI", "DP", "DVI1", "DVI2"],
  },
};
