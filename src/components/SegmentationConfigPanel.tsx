import type { Dispatch, SetStateAction } from 'react'
import type { TaskFormState } from '../app/state'

interface SegmentationConfigPanelProps {
  taskForm: TaskFormState
  setTaskForm: Dispatch<SetStateAction<TaskFormState>>
}

export function SegmentationConfigPanel(props: SegmentationConfigPanelProps) {
  const { taskForm, setTaskForm } = props

  return (
    <div className="segmentation-config-panel">
      <label>
        分段策略
        <select
          value={taskForm.segmentationStrategy}
          onChange={(event) =>
            setTaskForm((prev) => ({
              ...prev,
              segmentationStrategy: event.target.value as TaskFormState['segmentationStrategy'],
            }))
          }
        >
          <option value="punctuation">按标点</option>
          <option value="sentence">按句法</option>
          <option value="duration">按时长</option>
        </select>
      </label>

      {taskForm.segmentationStrategy === 'duration' && (
        <label>
          目标时长（秒）
          <input
            type="number"
            min={4}
            max={30}
            step={1}
            value={taskForm.segmentationTargetDurationSec}
            onChange={(event) =>
              setTaskForm((prev) => ({
                ...prev,
                segmentationTargetDurationSec: Math.max(4, Math.min(30, Number(event.target.value) || 8)),
              }))
            }
          />
        </label>
      )}
    </div>
  )
}
