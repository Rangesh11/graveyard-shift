# Social Blitz post (draft)

The rules ask for a post that starts with the hashtag and talks about your favourite Kiro feature. Add the repo link once it's public.

---

#KiroweenHackathon26 My favourite Kiro feature: hooks that rerun property-based proofs every time I save a fix.

I built Graveyard Shift, which fixes abandoned npm packages. Every fix must agree with the original code on hundreds of generated inputs. On save, a hook reran the proof for left-pad and rejected the fix its deprecation notice recommends: leftPad(0, 2, false) gives " 0", but padStart gives "f0".

Specs kept each part honest, and steering kept the safety rules in front of every agent. Dead code gets a night crew. 🪦

[repo link]
