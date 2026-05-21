# ASTR Privacy Roadmap

ASTR protects private message contents and transcript integrity. Current WFF does not hide who has accepted a private conversation with whom, and it does not resist timing, IP, notification, or routing correlation.

## Ranking Boundary

Private message plaintext and ciphertext must not be used for public ranking or recommendations. Accepted conversation relationships should not be used for public ranking unless that use is explicitly documented, privacy-reviewed, and optional.

## Future Metadata Reduction

Potential future work:

- opaque pairwise channel IDs;
- rotating channel hints;
- sealed-sender-style sender envelopes;
- generic push notifications without message-specific preview text;
- avoiding per-conversation Socket.IO room joins where practical;
- packet padding;
- delayed or batched delivery;
- optional relay or mixnet layer;
- private retrieval or PIR exploration;
- separation between public identity and private routing identity.

## Product Boundary

WFF is a public foresight and policy forum with public posts, public comments, votes, search, recommendations, message requests, chatroom, and notifications. ASTR should harden private message content and integrity without pretending that the whole app provides private routing or sender anonymity.
