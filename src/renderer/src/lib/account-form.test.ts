import { describe, expect, it } from 'vitest'
import { validateNewAccount } from '@shared/account-validation'
import {
  EMPTY_FORM,
  LOCAL_TEST_SERVER,
  portForSecurity,
  suggestedHosts,
  toAccountInput,
} from './account-form'
import { errorMessage } from './errors'

describe('toAccountInput', () => {
  it('uses the email address as user name when none is given', () => {
    const input = toAccountInput({ ...EMPTY_FORM, email: ' alice@example.com ' })
    expect(input.settings.username).toBe('alice@example.com')
    expect(input.email).toBe('alice@example.com')
  })

  it('turns ports into numbers, and an empty port into an invalid one', () => {
    const input = toAccountInput({ ...EMPTY_FORM, imapPort: '143', smtpPort: ' ' })
    expect(input.settings.imap.port).toBe(143)
    expect(Number.isNaN(input.settings.smtp.port)).toBe(true)
  })

  it('produces a valid account from the local test server preset plus a password', () => {
    const input = toAccountInput({ ...LOCAL_TEST_SERVER, password: 'x' })
    expect(validateNewAccount(input)).toEqual({})
  })
})

describe('portForSecurity', () => {
  it('moves standard ports along with the security mode', () => {
    expect(portForSecurity('imap', '993', 'starttls')).toBe('143')
    expect(portForSecurity('imap', '143', 'tls')).toBe('993')
    expect(portForSecurity('smtp', '465', 'starttls')).toBe('587')
    expect(portForSecurity('smtp', '587', 'tls')).toBe('465')
  })

  it('leaves custom ports alone', () => {
    expect(portForSecurity('imap', '1993', 'starttls')).toBe('1993')
  })
})

describe('suggestedHosts', () => {
  it('derives server names from the email domain', () => {
    expect(suggestedHosts('alice@example.org')).toEqual({
      imap: 'imap.example.org',
      smtp: 'smtp.example.org',
    })
  })

  it('falls back to examples while the address is incomplete', () => {
    expect(suggestedHosts('alice@')).toEqual({ imap: 'imap.example.com', smtp: 'smtp.example.com' })
  })
})

describe('errorMessage', () => {
  it('removes the Electron IPC prefix', () => {
    const error = new Error(
      "Error invoking remote method 'accounts:add': Error: alice@example.com has already been added.",
    )
    expect(errorMessage(error)).toBe('alice@example.com has already been added.')
  })

  it('keeps other messages as they are', () => {
    expect(errorMessage(new Error('Plain message'))).toBe('Plain message')
    expect(errorMessage('text')).toBe('text')
  })
})
