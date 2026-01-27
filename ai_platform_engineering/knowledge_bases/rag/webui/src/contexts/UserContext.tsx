import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { getUserInfo } from '../api'
import type { UserInfo } from '../ui/Models'

interface UserContextType {
	userInfo: UserInfo | null
	isLoading: boolean
	isUnauthenticated: boolean
	refreshUserInfo: () => Promise<void>
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export function UserProvider({ children }: { children: ReactNode }) {
	const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [isUnauthenticated, setIsUnauthenticated] = useState(false)
	const [retryCount, setRetryCount] = useState(0)

	const fetchUserInfo = useCallback(async () => {
		console.log('fetchUserInfo called, retryCount:', retryCount)
		setIsLoading(true)
		try {
			console.log('Calling getUserInfo API...')
			const data = await getUserInfo()
			setUserInfo(data)
			setRetryCount(0) // Reset retry count on success
			setIsUnauthenticated(false) // Clear unauthenticated flag on success
			console.log('User info fetched successfully:', data.email)
		} catch (err: any) {
			console.warn('Failed to fetch user info', err)
			setUserInfo(null)
			
			// Check if error is 401 Unauthorized
			if (err?.response?.status === 401) {
				console.error('User is unauthenticated (401) - session expired or not logged in')
				setIsUnauthenticated(true)
				setIsLoading(false)
				return // Don't retry on 401
			}
			
			// Retry up to 8 times with exponential backoff (for OAuth2 redirect scenarios)
			// This gives OAuth2 proxy more time to set headers after redirect
			if (retryCount < 8) {
				const retryDelay = Math.min(500 * Math.pow(1.5, retryCount), 5000) // 500ms, 750ms, 1.1s, 1.7s, 2.5s, 3.8s, 5s, 5s
				console.log(`Retrying user info fetch in ${retryDelay}ms (attempt ${retryCount + 1}/8)`)
				setTimeout(() => {
					setRetryCount(prev => prev + 1)
				}, retryDelay)
			} else {
				console.error('Max retries reached for fetching user info')
			}
		} finally {
			setIsLoading(false)
		}
	}, [retryCount])

	// Initial fetch on mount - add small delay if this is potentially after OAuth2 redirect
	useEffect(() => {
		console.log('UserProvider mounted, checking for OAuth2 redirect...')
		// Check if we're coming from OAuth2 redirect (URL contains oauth2 in referrer or has specific params)
		const urlParams = new URLSearchParams(window.location.search)
		const isOAuth2Redirect = document.referrer.includes('oauth2') || urlParams.has('rd')
		
		if (isOAuth2Redirect) {
			console.log('Detected OAuth2 redirect, adding initial delay before fetching user info')
			// Wait a bit longer for OAuth2 proxy to fully set headers
			setTimeout(() => {
				fetchUserInfo()
			}, 500)
		} else {
			console.log('Normal load, fetching user info immediately')
			fetchUserInfo()
		}
	}, [fetchUserInfo])

	// Retry when retryCount changes
	useEffect(() => {
		console.log('retryCount changed to:', retryCount)
		if (retryCount > 0) {
			console.log('Triggering retry...')
			fetchUserInfo()
		}
	}, [retryCount, fetchUserInfo])

	const value = {
		userInfo,
		isLoading,
		isUnauthenticated,
		refreshUserInfo: fetchUserInfo,
	}

	return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
	const context = useContext(UserContext)
	if (context === undefined) {
		throw new Error('useUser must be used within a UserProvider')
	}
	return context
}
