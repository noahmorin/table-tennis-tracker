<template>
  <section class="page">
    <header class="page-header">
      <h2>Submit Match</h2>
      <p>Fast entry with validated game scores.</p>
    </header>

    <form class="form-card">
      <label class="field">
        <span>Opponent</span>
        <select>
          <option>Select a player</option>
        </select>
      </label>
      <label class="field">
        <span>Match Date</span>
        <input type="date" />
      </label>
      <div class="field-row">
        <label class="field">
          <span>Game 1</span>
          <input type="text" placeholder="11 - 8" />
        </label>
        <label class="field">
          <span>Game 2</span>
          <input type="text" placeholder="11 - 9" />
        </label>
      </div>
      <label class="field">
        <span>Game 3 (Optional)</span>
        <input type="text" placeholder="11 - 7" />
      </label>
      <label class="field">
        <span>Notes</span>
        <textarea rows="3" placeholder="Optional notes"></textarea>
      </label>
      <button type="button" class="primary-btn">Submit Match</button>
    </form>
  </section>
</template>
