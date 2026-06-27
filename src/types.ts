export interface User {
  id: number
  oauth_id: string
  username: string
  email: string | null
  avatar_url: string | null
  created_at: string
}

export interface Board {
  id: number
  name: string
  owner_id: number
  created_at: string
}

export interface Task {
  id: number
  board_id: number
  title: string
  notes: string | null
  due_date: string | null
  priority: 'low' | 'normal' | 'high'
  status: 'todo' | 'in_progress' | 'done'
  completed_at: string | null
  created_by: number
  position: number
  created_at: string
  is_overdue?: boolean
}

export interface BoardMember {
  board_id: number
  user_id: number
  role: 'owner' | 'collaborator'
  username: string
  avatar_url: string | null
  joined_at: string
}

export interface Invitation {
  id: number
  board_id: number
  email: string
  token: string
  invited_by: number
  accepted_at: string | null
  expires_at: string
  created_at: string
}

declare global {
  namespace Express {
    interface User {
      id: number
      oauth_id: string
      username: string
      email: string | null
      avatar_url: string | null
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    returnTo?: string
  }
}
