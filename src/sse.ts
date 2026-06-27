import type { Response } from 'express'

interface Client {
  res: Response
  boardId: number
}

const clients = new Set<Client>()

export function addClient(res: Response, boardId: number): () => void {
  const client: Client = { res, boardId }
  clients.add(client)
  return () => clients.delete(client)
}

// Send an HTML fragment to all clients watching a given board.
// The fragment must use hx-swap-oob to target specific DOM elements.
export function broadcast(boardId: number, html: string): void {
  const data = html.replace(/\n/g, '\ndata: ')
  for (const client of clients) {
    if (client.boardId === boardId) {
      client.res.write(`data: ${data}\n\n`)
    }
  }
}
