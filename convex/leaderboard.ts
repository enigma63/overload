import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const COLORS = ["--blue", "--green", "--yellow", "#7A4FD0", "#0E9AA7", "#D06A1F", "--red"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function colorFor(playerId: string) {
  let h = 0;
  for (const ch of playerId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function cleanName(name: string) {
  const n = name.trim().replace(/\s+/g, " ").slice(0, 24);
  if (!n) throw new Error("Name is required");
  return n;
}

// Called by the app whenever the player's steps change. Upserts the player and their recent days.
export const sync = mutation({
  args: {
    playerId: v.string(),
    name: v.string(),
    streak: v.number(),
    days: v.array(v.object({ date: v.string(), steps: v.number() })),
  },
  handler: async (ctx, { playerId, name, streak, days }) => {
    if (playerId.length < 16 || playerId.length > 64) throw new Error("Bad player id");
    if (days.length > 14) throw new Error("Too many days");

    const fields = {
      name: cleanName(name),
      streak: Math.max(0, Math.min(1000, Math.round(streak))),
      updatedAt: Date.now(),
    };
    const existing = await ctx.db
      .query("players")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .unique();
    const player = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("players", { playerId, color: colorFor(playerId), ...fields });

    for (const { date, steps } of days) {
      if (!DATE.test(date)) continue;
      const value = Math.max(0, Math.min(100000, Math.round(steps)));
      const row = await ctx.db
        .query("steps")
        .withIndex("by_player_date", (q) => q.eq("player", player).eq("date", date))
        .unique();
      if (row) {
        if (row.steps !== value) await ctx.db.patch(row._id, { steps: value });
      } else if (value > 0) {
        await ctx.db.insert("steps", { player, date, steps: value });
      }
    }
    return player;
  },
});

// Removes the player and all their step history from the shared board.
export const leave = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }) => {
    const p = await ctx.db
      .query("players")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .unique();
    if (!p) return;
    const rows = await ctx.db
      .query("steps")
      .withIndex("by_player_date", (q) => q.eq("player", p._id))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    await ctx.db.delete(p._id);
  },
});

// Live leaderboard: today's and this week's steps for everyone who has joined.
// `dates` is the week the client counts (the last 7 local days, today first).
export const board = query({
  args: { today: v.string(), dates: v.array(v.string()) },
  handler: async (ctx, { today, dates }) => {
    const week = dates.filter((d) => DATE.test(d)).slice(0, 7);
    const totals = new Map<string, { today: number; week: number }>();
    for (const date of week) {
      const rows = await ctx.db
        .query("steps")
        .withIndex("by_date", (q) => q.eq("date", date))
        .take(1000);
      for (const r of rows) {
        const t = totals.get(r.player) ?? { today: 0, week: 0 };
        t.week += r.steps;
        if (date === today) t.today += r.steps;
        totals.set(r.player, t);
      }
    }
    const players = await ctx.db.query("players").order("desc").take(500);
    return players.map((p) => ({
      id: p._id,
      name: p.name,
      streak: p.streak,
      c: p.color,
      today: totals.get(p._id)?.today ?? 0,
      week: totals.get(p._id)?.week ?? 0,
    }));
  },
});
