// Confirm-delete name input: enable the delete button only when the typed name matches
document.addEventListener('input', function (e) {
  const input = e.target
  if (!('boardName' in input.dataset)) return
  input.form.querySelector('.btn-danger').disabled = input.value !== input.dataset.boardName
})

// Copy invite link to clipboard
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-copy]')
  if (!btn) return
  navigator.clipboard.writeText(btn.dataset.copy).then(function () {
    const original = btn.textContent
    btn.textContent = 'Copied!'
    setTimeout(function () { btn.textContent = original }, 2000)
  })
})

// Cancel buttons: clear the element named by data-clear-target
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-clear-target]')
  if (!btn) return
  const target = document.getElementById(btn.dataset.clearTarget)
  if (target) target.innerHTML = ''
})

// Clear the new-board form after a board is successfully created
document.addEventListener('htmx:afterRequest', function (e) {
  if (!e.detail.successful) return
  const form = e.target.closest && e.target.closest('.new-board-form')
  if (!form) return
  const container = document.getElementById('new-board-form')
  if (container) container.innerHTML = ''
})
