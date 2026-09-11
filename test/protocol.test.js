import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checksum,
  encodeWrite,
  makeAck,
  parsePacket,
  recallPreset,
  set3D,
  setBlackout,
  setBrightness,
  setControllerMode,
  setFreeze,
  setLayerSource,
  setLowLatency,
  setNormalDisplay,
  toHex,
  REG,
} from "../server/protocol.js";
import { createSimulator } from "../server/simulator.js";
import { sendTcp } from "../server/transport.js";
import { createStore } from "../server/store.js";
import { createShow } from "../server/show.js";
import { assignOutputs, windowFeatures } from "../web/src/screens.js";

function hex(buf) {
  return toHex(buf);
}

describe("NovaStar central control packets", () => {
  it("matches official brightness 0% packet", () => {
    assert.equal(
      hex(setBrightness(0)),
      "55aa0000feff01ffffff010001000002010000555a",
    );
  });

  it("computes brightness 100% checksum", () => {
    const pkt = setBrightness(255);
    const parsed = parsePacket(pkt);
    assert.equal(parsed.register, REG.BRIGHTNESS);
    assert.equal(parsed.data[0], 0xff);
    assert.equal(parsed.validChecksum, true);
  });

  it("matches official blackout packet", () => {
    assert.equal(
      hex(setBlackout(true)),
      "55aa0000feff01ffffff0100000100020100ff545b",
    );
  });

  it("matches official freeze / unfreeze / normal packets", () => {
    assert.equal(
      hex(setFreeze(true)),
      "55aa0000feff01ffffff0100020100020100ff565b",
    );
    assert.equal(
      hex(setFreeze(false)),
      "55aa0000feff01ffffff010002010002010000575a",
    );
    assert.equal(
      hex(setNormalDisplay()),
      "55aa0000feff01ffffff010000010002010000555a",
    );
  });

  it("matches official preset 1 and 2 packets", () => {
    assert.equal(
      hex(recallPreset(1)),
      "55aa0000feff01ffffff01000200000a0100015f5a",
    );
    assert.equal(
      hex(recallPreset(2)),
      "55aa0000feff01ffffff01000200000a010002605a",
    );
  });

  it("matches official low-latency and 3D packets", () => {
    assert.equal(
      hex(setLowLatency(true)),
      "55aa0000feff01ffffff010011010010010001755a",
    );
    assert.equal(
      hex(setLowLatency(false)),
      "55aa0000feff01ffffff010011010010010000745a",
    );
    assert.equal(
      hex(set3D(true)).toLowerCase(),
      "55aa0000feff01ffffff0100160100100100017a5a",
    );
  });

  it("matches send-only controller mode packet", () => {
    assert.equal(
      hex(setControllerMode("send-only")),
      "55aa0000feff01ffffff0100f2ff08000100004b5c",
    );
  });

  it("matches layer source packet", () => {
    assert.equal(
      hex(setLayerSource(1, 1, 0)).toLowerCase(),
      "55aa0000feff01ffffff01000300000a0300010100635a",
    );
  });

  it("checksum helper matches documented 0x5555 offset", () => {
    const content = Buffer.from("0000feff01ffffff010001000002010000", "hex");
    assert.equal(checksum(content).toString("hex"), "555a");
  });
});

describe("simulator", () => {
  it("accepts brightness over TCP and returns an ACK", async () => {
    const sim = await createSimulator({
      host: "127.0.0.1",
      port: 0,
      name: "lab-1",
      model: "GENERIC",
    });
    try {
      const reply = await sendTcp("127.0.0.1", sim.port, setBrightness(128));
      assert.equal(reply.ok, true);
      assert.equal(sim.getState().brightness, 128);
      const ack = makeAck(setBrightness(128));
      assert.equal(ack[0], 0xaa);
      assert.equal(ack[1], 0x55);
    } finally {
      await sim.close();
    }
  });

  it("applies freeze and input routing", async () => {
    const sim = await createSimulator({
      host: "127.0.0.1",
      port: 0,
      name: "lab-2",
      model: "GENERIC",
    });
    try {
      await sendTcp("127.0.0.1", sim.port, setFreeze(true));
      await sendTcp("127.0.0.1", sim.port, setLayerSource(1, 0, 1));
      const state = sim.getState();
      assert.equal(state.freeze, true);
      assert.equal(state.input.iface, 1);
    } finally {
      await sim.close();
    }
  });
});

describe("project store", () => {
  it("names a new controller as a generic display", () => {
    const store = createStore();
    const controller = store.addController({ host: "10.0.0.8" });
    assert.equal(controller.name, "Display 1");
    assert.equal(controller.model, "GENERIC");
  });

  it("tiles 4 controllers as 2x2 on the canvas", () => {
    const store = createStore();
    for (let i = 0; i < 4; i += 1) {
      store.addController({ host: `192.168.1.${10 + i}` });
    }
    store.autoLayout("2x2");
    const [a, b, c, d] = store.project.controllers;
    assert.equal(a.viewport.x, 0);
    assert.equal(b.viewport.x, 3840);
    assert.equal(c.viewport.y, 1080);
    assert.equal(d.viewport.x, 3840);
    assert.equal(d.viewport.y, 1080);
  });

  it("recalls a preset snapshot", () => {
    const store = createStore();
    const controller = store.addController({ host: "10.0.0.8" });
    controller.brightness = 10;
    const preset = store.addPreset("Show");
    controller.brightness = 255;
    store.applyPreset(preset.id);
    assert.equal(store.getController(controller.id).brightness, 10);
  });

  it("merges older project files with new screen fields", () => {
    const store = createStore();
    store.replace({ name: "Old", controllers: [], layers: [], presets: [] });
    assert.equal(store.project.osd.enabled, false);
    assert.equal(store.project.color.contrast, 100);
    assert.equal(store.project.sources.length, 4);
  });

  it("adds a stage cue from the media bin without filling the whole canvas", () => {
    const store = createStore();
    const media = store.addMedia({ name: "loop.mp4", kind: "video", filename: "loop.mp4" });
    assert.equal(store.project.clips.length, 0);
    const clip = store.addClip({ mediaId: media.id });
    assert.equal(clip.width, 1920);
    assert.equal(clip.height, 1080);
    assert.equal(clip.start, 0);
    assert.equal(clip.duration, 10);
    assert.equal(store.project.clips.length, 1);
    store.removeMedia(media.id);
    assert.equal(store.project.clips.length, 0);
  });
});

describe("layer take routing", () => {
  it("routes each sender from the top overlapping layer", async () => {
    const { takeMap } = await import("../server/routing.js");
    const project = {
      controllers: [
        { id: "a", inputKey: "HDMI", viewport: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: "b", inputKey: "HDMI", viewport: { x: 1920, y: 0, width: 1920, height: 1080 } },
      ],
      layers: [
        { id: "l1", visible: true, z: 1, source: "DP", x: 0, y: 0, width: 3840, height: 1080 },
        { id: "l2", visible: true, z: 2, source: "DVI1", x: 1920, y: 0, width: 1920, height: 1080 },
      ],
    };
    const routes = takeMap(project);
    assert.equal(routes.find((r) => r.controllerId === "a").inputKey, "DP");
    assert.equal(routes.find((r) => r.controllerId === "b").inputKey, "DVI1");
  });
});

describe("show clock", () => {
  it("plays, seeks, and stops from a shared playhead", () => {
    const show = createShow();
    assert.equal(show.snapshot().playing, false);
    assert.equal(show.snapshot().mediaTime, 0);
    show.seek(12.5);
    assert.equal(show.snapshot().mediaTime, 12.5);
    show.play();
    assert.equal(show.snapshot().playing, true);
    show.pause();
    assert.equal(show.snapshot().playing, false);
    assert.ok(show.snapshot().mediaTime >= 12.5);
    show.stop();
    assert.equal(show.snapshot().playing, false);
    assert.equal(show.snapshot().mediaTime, 0);
  });
});

describe("GPU output placement", () => {
  it("prefers extra OS screens so the production desk can stay on the primary", () => {
    const screens = [
      { id: "0", label: "Laptop", isPrimary: true, left: 0, top: 0, width: 1920, height: 1080 },
      { id: "1", label: "HDMI-1", isPrimary: false, left: 1920, top: 0, width: 3840, height: 2160 },
      { id: "2", label: "DP-1", isPrimary: false, left: 5760, top: 0, width: 3840, height: 2160 },
    ];
    const mapped = assignOutputs(screens, 4);
    assert.equal(mapped[0].label, "HDMI-1");
    assert.equal(mapped[1].label, "DP-1");
    assert.equal(mapped[2], null);
    assert.equal(mapped[3], null);
  });

  it("builds a popup placed on that OS screen", () => {
    assert.match(
      windowFeatures({ left: 1920, top: 0, width: 3840, height: 2160 }),
      /left=1920,top=0,width=3840,height=2160/,
    );
  });
});

describe("packet parser", () => {
  it("rejects truncated frames", () => {
    assert.equal(parsePacket(Buffer.from("55aa00", "hex")), null);
  });

  it("round-trips encodeWrite", () => {
    const pkt = encodeWrite(REG.BRIGHTNESS, [0x40]);
    const parsed = parsePacket(pkt);
    assert.equal(parsed.validChecksum, true);
    assert.equal(parsed.data[0], 0x40);
  });
});
