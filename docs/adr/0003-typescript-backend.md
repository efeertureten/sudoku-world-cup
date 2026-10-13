# ADR 0003: Node.js and TypeScript for the backend

Status: accepted (2026-10-13)

**Context.** The brief allowed Node.js (Express + Socket.io) or Python (FastAPI + WebSockets).

**Decision.** Node.js 22 with TypeScript, Express 5 and Socket.io 4.

**Consequences.** Client and server share types, zod schemas and the engine with no code generation. Socket.io brings acknowledgements, rooms, reconnection and a Redis adapter for multiple instances. Contributors need to know one language.
