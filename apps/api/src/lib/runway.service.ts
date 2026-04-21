/**
 * Runway ML API Integration
 * Real API: https://docs.dev.runwayml.com
 *
 * Runway is a generative AI video tool — image-to-video, text-to-video.
 * It does NOT do traditional color grading or video editing.
 * Use Descript's agent for editing; use Runway for AI-generated video clips.
 */

import axios from 'axios'

const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1'
const RUNWAY_VERSION = '2024-11-06'

export interface RunwayTask {
  id: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  output?: string[] // Output URLs when complete
  failure?: string
  createdAt?: string
}

export class RunwayService {
  private apiKey: string

  constructor(apiKey: string = process.env.RUNWAY_API_KEY || '') {
    this.apiKey = apiKey
  }

  private async request(method: string, endpoint: string, data?: any) {
    try {
      const response = await axios({
        method,
        url: `${RUNWAY_API_BASE}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': RUNWAY_VERSION,
        },
        data,
        timeout: 30000,
      })
      return response.data
    } catch (err: any) {
      console.error(`[runway] ${method} ${endpoint} failed:`, err.response?.data || err.message)
      throw new Error(`Runway API error: ${err.response?.data?.error || err.message}`)
    }
  }

  /**
   * Generate a video from an image (image-to-video).
   * Useful for creating B-roll or visual content from thumbnails/stills.
   */
  async imageToVideo(params: {
    promptImage: string  // URL to source image
    promptText?: string  // Text description for motion/style
    model?: string       // gen4, gen4.5
    ratio?: string       // e.g. '1280:720', '720:1280'
    duration?: number    // 5 or 10 seconds
  }): Promise<RunwayTask> {
    return this.request('POST', '/image_to_video', {
      promptImage: params.promptImage,
      promptText: params.promptText || '',
      model: params.model || 'gen4',
      ratio: params.ratio || '720:1280', // Vertical for Reels
      duration: params.duration || 5,
    })
  }

  /**
   * Generate a video from text only.
   */
  async textToVideo(params: {
    promptText: string
    model?: string
    ratio?: string
    duration?: number
  }): Promise<RunwayTask> {
    return this.request('POST', '/text_to_video', {
      promptText: params.promptText,
      model: params.model || 'gen4',
      ratio: params.ratio || '720:1280',
      duration: params.duration || 5,
    })
  }

  /**
   * Get task status.
   */
  async getTask(taskId: string): Promise<RunwayTask> {
    return this.request('GET', `/tasks/${taskId}`)
  }

  /**
   * Poll a task until it completes or times out.
   */
  async waitForTask(taskId: string, timeoutMs = 300000, pollIntervalMs = 5000): Promise<RunwayTask> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const task = await this.getTask(taskId)
      if (task.status === 'SUCCEEDED') return task
      if (task.status === 'FAILED') throw new Error(`Runway task failed: ${task.failure}`)
      console.log(`[runway] Task ${taskId}: ${task.status}`)
      await new Promise(r => setTimeout(r, pollIntervalMs))
    }
    throw new Error(`Runway task ${taskId} timed out after ${timeoutMs / 1000}s`)
  }

  /**
   * Cancel/delete a task.
   */
  async cancelTask(taskId: string): Promise<void> {
    await this.request('DELETE', `/tasks/${taskId}`)
  }
}

export default RunwayService
