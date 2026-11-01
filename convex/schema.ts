import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per device that has joined the live leaderboard.
  // playerId is a random secret kept in the browser; it is never sent back to other players.
  players: defineTable({
    playerId: v.string(),
    name: v.string(),
    streak: v.number(),
    color: v.string(),
    updatedAt: v.number(),
  }).index("by_playerId", ["playerId"]),

  // Step count per player per day (date is YYYY-MM-DD in the player's local time).
  steps: defineTable({
    player: v.id("players"),
    date: v.string(),
    steps: v.number(),
  })
    .index("by_player_date", ["player", "date"])
    .index("by_date", ["date"]),
});
