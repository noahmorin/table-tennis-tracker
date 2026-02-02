<template>
  <section class="page">
    <header class="page-header">
      <h2>Player Profile</h2>
      <p>Neutral, view-only stats for a single player.</p>
    </header>

    <div class="card">
      <p>Match history</p>
      <router-link class="ghost-btn" :to="`/players/${$route.params.id}/matches`">Matches</router-link>
    </div>

    <div class="card-grid">
      <article class="card">
        <h3>Overview</h3>
        <p>Matches, win rate, and game differential.</p>
      </article>
      <article class="card">
        <h3>Elo Trend</h3>
        <p>Filtered and ordered by match date.</p>
      </article>
      <article class="card">
        <h3>Matchups</h3>
        <p>Best and toughest opponents by record.</p>
      </article>
    </div>
  </section>
</template>
