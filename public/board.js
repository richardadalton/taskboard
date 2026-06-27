(function () {
  const page = document.querySelector('[data-board-id]')
  if (!page) return
  const boardId = page.dataset.boardId

  function initSortable(status) {
    const col = document.getElementById('column-' + status + '-list')
    if (!col) return

    new Sortable(col, {
      group: 'kanban',
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'task-ghost',
      onEnd: function (evt) {
        const taskId = evt.item.dataset.taskId
        const newStatus = evt.to.dataset.status
        const ids = Array.from(evt.to.querySelectorAll('[data-task-id]'))
          .map(function (el) { return el.dataset.taskId })
          .join(',')
        htmx.ajax('PATCH', '/tasks/' + taskId + '/move', {
          values: { status: newStatus, ids: ids },
          swap: 'none',
        })
      },
    })
  }

  initSortable('todo')
  initSortable('in_progress')
  initSortable('done')
})()
