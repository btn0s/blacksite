import { createAudioLog } from '@blacksite/check'
import { isTouchDevice } from '@blacksite/look/world'
import { createSoundscape } from '@blacksite/soundscape'
import { BUDGET } from './model'

export const soundTier = isTouchDevice() ? 'phone' : 'desktop'
export const voiceCap = soundTier === 'phone' ? BUDGET.phoneVoices : BUDGET.voices

export const sound = createSoundscape({ tier: soundTier, voiceCap, log: createAudioLog() })
sound.setZone('outdoor')
