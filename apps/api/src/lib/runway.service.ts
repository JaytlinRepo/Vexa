/**
 * Runway ML API Integration
 * Handles video editing, color grading, effects
 */

import axios from 'axios'

const RUNWAY_API_BASE = 'https://api.runwayml.com/v1'

export class RunwayService {
  private apiKey: string

  constructor(apiKey: string = process.env.RUNWAY_API_KEY!) {
    this.apiKey = apiKey
  }

  private async request(method: string, endpoint: string, data?: any) {
    try {
      const response = await axios({
        method,
        url: `${RUNWAY_API_BASE}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        data,
        timeout: 30000
      })
      return response.data
    } catch (err: any) {
      console.error(`[runway] ${method} ${endpoint} failed:`, err.response?.data || err.message)
      throw err
    }
  }

  /**
   * Edit video with color grading and effects
   */
  async editVideo(videoUrl: string, edits: {
    colorGrading?: {
      temperature?: number
      saturation?: number
      contrast?: number
      warmth?: number
    }
    effects?: {
      filmGrain?: number
      vignette?: number
    }
  }) {
    // Upload video
    const uploadedVideo = await this.request('POST', '/assets', {
      name: `edit_${Date.now()}`,
      source_url: videoUrl,
      asset_type: 'video'
    })

    // Create editing task
    const editTask = await this.request('POST', '/tasks', {
      model: 'gen3',
      task_type: 'color_grading',
      payload: {
        video_id: uploadedVideo.asset.id,
        ...edits
      }
    })

    // Wait for completion
    let task = editTask.task
    let attempts = 0
    while (task.status !== 'COMPLETE' && task.status !== 'FAILED' && attempts < 120) {
      // Max 4 minutes
      await new Promise(r => setTimeout(r, 2000))
      const response = await this.request('GET', `/tasks/${task.id}`)
      task = response.task
      attempts++
    }

    if (task.status === 'FAILED') {
      throw new Error(`Runway task failed: ${task.error}`)
    }

    return task.output?.video_url || videoUrl
  }

  /**
   * Get task status
   */
  async getTask(taskId: string) {
    const response = await this.request('GET', `/tasks/${taskId}`)
    return response.task
  }
}

export default RunwayService
