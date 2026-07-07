import type { WebexRoomSource } from "@/types/projects";

/**
 * Webex rooms flow through the generic source-picker contract, which speaks
 * `string[]`. To carry a room's display name (not just its opaque base64 ID)
 * we encode each selection as a compact JSON blob and decode at the
 * persistence boundary into a typed `WebexRoomSource`.
 */

interface DecodedRoom {
  room_id: string;
  name: string;
}

/** Encode a picked room (id + title) into the picker's `string[]` slot. */
export function encodeWebexRoom(roomId: string, name: string): string {
  return JSON.stringify({ room_id: roomId, name });
}

/** Decode a picker slot back to `{room_id, name}`. Tolerates a bare room ID
 * (legacy / manual entry) by using the ID as the name fallback. */
export function decodeWebexRoom(value: string): DecodedRoom {
  try {
    const o = JSON.parse(value) as { room_id?: unknown; name?: unknown };
    if (o && typeof o.room_id === "string") {
      return {
        room_id: o.room_id,
        name: typeof o.name === "string" && o.name ? o.name : o.room_id,
      };
    }
  } catch {
    /* not JSON — treat as a bare room id */
  }
  return { room_id: value, name: value };
}

/** Stable, readable wiki-folder slug for a room. Prefers the name; falls back
 * to the first UUID segment decoded from the base64 room ID. */
export function webexRoomSlug(name: string, roomId: string): string {
  const fromName = (name || "")
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (fromName) return fromName.slice(0, 48);
  try {
    const decoded =
      typeof Buffer !== "undefined"
        ? Buffer.from(roomId, "base64").toString("utf-8")
        : atob(roomId);
    const uuid = decoded.split("/").pop() ?? roomId;
    return uuid.split("-")[0] || roomId.slice(0, 8);
  } catch {
    return roomId.slice(0, 8);
  }
}

/** Turn a picker slot into the typed `WebexRoomSource` we persist. */
export function toWebexRoomSource(value: string): WebexRoomSource {
  const { room_id, name } = decodeWebexRoom(value);
  return { room_id, name, slug: webexRoomSlug(name, room_id) };
}

/** Encode a stored `WebexRoomSource` back into a picker slot. */
export function webexRoomToPickerValue(r: WebexRoomSource): string {
  return encodeWebexRoom(r.room_id, r.name);
}
