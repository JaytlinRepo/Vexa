/**
 * Descript API Integration
 * Real API: https://docs.descriptapi.com
 *
 * Flow: import media → agent edit (clip + style) → poll job → get project URL
 * Export limitation: no programmatic export — result is a Descript project URL
 * that the user can publish/download from Descript's web UI.
 */

import axios from 'axios'

const DESCRIPT_API_BASE = 'https://descriptapi.com/v1'

export interface DescriptJob {
  job_id: string
  drive_id: string
  project_id: string
  project_url: string
  upload_urls?: Record<string, { upload_url: string; asset_id: string; artifact_id: string }>
}

export interface DescriptJobStatus {
  job_id: string
  job_type: string
  job_state: 'running' | 'stopped'
  project_id: string
  project_url: string
  progress?: { label: string; last_update_at: string }
  result?: {
    status: 'success' | 'failure'
    agent_response?: string
    project_changed?: boolean
    media_seconds_used?: number
    created_compositions?: Array<{ id: string; name: string }>
  }
}

export class DescriptClient {
  private apiKey: string

  constructor(apiKey: string = process.env.DESCRIPTION_API_KEY || process.env.DESCRIPT_API_KEY || '') {
    this.apiKey = apiKey
  }

  private async request(method: string, endpoint: string, data?: any) {
    try {
      const response = await axios({
        method,
        url: `${DESCRIPT_API_BASE}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        data,
      })
      return response.data
    } catch (err: any) {
      console.error(`[descript] ${method} ${endpoint} failed:`, err.response?.data || err.message)
      throw new Error(`Descript API error: ${err.response?.data?.message || err.message}`)
    }
  }

  /**
   * Import a video by URL into a new Descript project.
   * Returns job info including project_id.
   */
  async importVideoByUrl(videoUrl: string, projectName: string): Promise<DescriptJob> {
    const mediaKey = `${projectName}.mp4`
    return this.request('POST', '/jobs/import/project_media', {
      project_name: projectName,
      add_media: {
        [mediaKey]: { url: videoUrl },
      },
      add_compositions: [
        { name: 'Main', clips: [{ media: mediaKey }] },
      ],
    })
  }

  /**
   * Import a video via direct upload (for files we have in memory/S3).
   * Returns upload_urls to PUT the raw bytes to.
   */
  async importVideoForUpload(
    projectName: string,
    fileName: string,
    contentType: string,
    fileSize: number,
  ): Promise<DescriptJob> {
    return this.request('POST', '/jobs/import/project_media', {
      project_name: projectName,
      add_media: {
        [fileName]: {
          content_type: contentType,
          file_size: fileSize,
        },
      },
      add_compositions: [
        { name: 'Main', clips: [{ media: fileName }] },
      ],
    })
  }

  /**
   * Upload raw file bytes to the presigned URL from importVideoForUpload.
   */
  async uploadFileToSignedUrl(uploadUrl: string, fileBuffer: Buffer, contentType: string): Promise<void> {
    await axios.put(uploadUrl, fileBuffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })
  }

  /**
   * Use Descript's AI agent to edit a project.
   * This replaces manual clipping + color grading — one prompt does it all.
   */
  async agentEdit(projectId: string, prompt: string): Promise<DescriptJob> {
    return this.request('POST', '/jobs/agent', {
      project_id: projectId,
      prompt,
    })
  }

  /**
   * Poll a job until it completes or times out.
   */
  async waitForJob(jobId: string, timeoutMs = 300000, pollIntervalMs = 3000): Promise<DescriptJobStatus> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const status: DescriptJobStatus = await this.request('GET', `/jobs/${jobId}`)
      if (status.job_state === 'stopped') {
        if (status.result?.status === 'failure') {
          throw new Error(`Descript job failed: ${status.result?.agent_response || 'unknown error'}`)
        }
        return status
      }
      console.log(`[descript] Job ${jobId}: ${status.progress?.label || 'processing'}`)
      await new Promise(r => setTimeout(r, pollIntervalMs))
    }
    throw new Error(`Descript job ${jobId} timed out after ${timeoutMs / 1000}s`)
  }

  /**
   * Get job status (single poll).
   */
  async getJobStatus(jobId: string): Promise<DescriptJobStatus> {
    return this.request('GET', `/jobs/${jobId}`)
  }

  /**
   * Get published project metadata (including download URL).
   * Requires the project to be published first via Descript's UI.
   */
  async getPublishedProject(slug: string): Promise<{
    download_url: string
    download_url_expires_at: string
    project_id: string
    metadata: { title: string; duration_seconds: number }
  }> {
    return this.request('GET', `/published_projects/${slug}`)
  }
}

export default DescriptClient
