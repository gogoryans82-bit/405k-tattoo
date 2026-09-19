# 405INK Booking Platform

Full-stack booking system. Node + Express + SQLite backend, vanilla JS frontend.

## Quickstart

    npm install
    npm run hashes          # generates admin slug + password hashes
    cp .env.example .env    # paste the hashes into .env
    npm start

Then open `https://yourdomain.com/<your-secret-slug>` to reach the admin panel.

## Layout

- `backend/`          → Express server, database, email
- `frontend/public/`  → static files served to the browser
- `scripts/`          → one-off tools

## Payment flow

Manual. Admin sets a deposit amount, client receives a "how to pay" email,
client pays outside the system, admin marks it paid, client receives confirmation.
