/**
 * Descript API Integration
 * Handles video transcription, magic shortform clipping
 */

import axios from 'axios'

const DESCRIPT_API_BASE = 'https://api.descript.com/v1'

export class DescriptClient {
  private apiKey: string

  constructor(apiKey: string = process.env.DESCRIPT_API_KEY!) {
    this.apiKey = apiKey
  }

  private async request(method: string, endpoint: string, data?: any) {
    try {
      const response = await axios({
        method,
        url: `${DESCRIPT_API_BASE}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        data
      })
      return response.data
    } catch (err: any) {
      console.error(`[descript] ${method} ${endpoint} failed:`, err.response?.data || err.message)
      throw err
    }
  }

  // Upload video to Descript
  async uploadVideo(videoUrl: string, options: { name?: string; transcribeAudio?: boolean } = {}) {
    const response = await this.request('POST', '/videos', {
      name: options.name || 'Untitled',
      source_url: videoUrl,
      transcribe_audio: options.transcribeAudio !== false
    })
    return response.video
  }

  // Get video details (including transcription status)
  async getVideo(videoId: string) {
    const response = await this.request('GET', `/videos/${videoId}`)
    return response.video
  }

  // Generate magic shortforms (auto-clipping)
  async generateMagicShortforms(
    videoId: string,
    options: { targetDuration?: number; count?: number } = {}
  ) {
    const response = await this.request('POST', `/videos/${videoId}/shortforms`, {
      target_duration: options.targetDuration || 60,
      max_count: options.count || 1
    })
    return response.shortforms || []
  }

  // Export/download video
  async exportVideo(videoId: string, options: { format?: string; quality?: string } = {}) {
    const response = await this.request('POST', `/videos/${videoId}/export`, {
      format: options.format || 'mp4',
      quality: options.quality || 'high'
    })
    return response.download_url
  }

  // Get transcript
  async getTranscript(videoId: string) {
    const response = await this.request('GET', `/videos/${videoId}/transcript`)
    return response.transcript
  }
}

export default DescriptClient
