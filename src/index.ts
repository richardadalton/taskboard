import 'dotenv/config'
import { createApp } from './app.js'

const PORT = Number(process.env.PORT ?? 3000)

createApp().listen(PORT, () => {
  console.log(`tasklist running at http://localhost:${PORT}`)
})
