// ── Artists — rich list for the /allartists page ────────────
router.get("/artists/public", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        COALESCE(specialty, '')     AS specialty,
        COALESCE(bio, '')           AS bio,
        COALESCE(image_url, '')     AS image_url,
        COALESCE(portfolio_url, '') AS portfolio_url,
        COALESCE(slug, '')          AS slug,
        COALESCE(instagram, '')     AS instagram
      FROM artists
      WHERE active = 1
      ORDER BY sort_order, name
    `);

    const artists = rows.map(a => ({
      id:            a.id,
      name:          a.name,
      specialty:     a.specialty,
      bio:           a.bio,
      image_url:     a.image_url,
      slug:          a.slug,
      instagram:     a.instagram,
      portfolio_url: a.portfolio_url || `/booking.html?artist=${encodeURIComponent(a.name)}`,
      booking_url:   `/booking.html?artist=${encodeURIComponent(a.name)}`,
    }));

    res.set("Cache-Control", "no-store, max-age=0");
    res.json(artists);
  } catch (err) { next(err); }
});
