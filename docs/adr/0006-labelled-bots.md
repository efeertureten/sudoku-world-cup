# ADR 0006: Bots are always labelled

Status: accepted (2026-10-13), amended the same day: bot wins score capped country points instead of none, after play-testing showed an empty table on a fresh install.

**Context.** Bots keep waiting times under five seconds. Many games disguise them as people.

**Decision.** Bots carry a bot badge everywhere. Bot games award half the trophies and only a few country points (3 per win, at most 30 per player per day).

**Consequences.** Players are never misled, which matters even more in an open-source project where the code would reveal the trick anyway. Leaderboards cannot be farmed against bots, yet a server with few people still has a living country table. Bots still feel human because their pace, cell choice and mistakes imitate people.
