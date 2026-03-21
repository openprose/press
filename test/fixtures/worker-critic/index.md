---
name: haiku-refiner
kind: program
services: [writer, critic]
---

# Haiku Refiner

A writer produces a haiku on a given topic. A critic evaluates it for adherence
to the 5-7-5 syllable structure and thematic quality. If the critic rejects it,
the writer tries again with the critic's feedback. Loop until accepted or 3 attempts.

requires:
- topic: the subject for the haiku

ensures:
- haiku: a polished haiku that passes critic review
- attempts: how many drafts were needed

### Execution

let draft = call writer
  topic: topic

let attempt = 1

loop until attempt > 3:
  let review = call critic
    draft: draft
    attempt: attempt

  if review.accepted:
    return { haiku: draft, attempts: attempt }

  let draft = call writer
    topic: topic
    feedback: review.feedback
    previous_draft: draft

  let attempt = attempt + 1

return { haiku: draft, attempts: attempt, note: "accepted after max attempts" }
