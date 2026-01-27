import React, { useState } from 'react'
import { useUser } from '../contexts/UserContext'

export default function UserProfile() {
	const { userInfo } = useUser()
	const [showDropdown, setShowDropdown] = useState(false)
	const [showGroups, setShowGroups] = useState(false)

	if (!userInfo) {
		return null
	}

	const getRoleBadgeColor = (role: string) => {
		switch (role) {
			case 'admin':
				return 'bg-purple-100 text-purple-700'
			case 'ingestonly':
				return 'bg-blue-100 text-blue-700'
			case 'readonly':
				return 'bg-slate-100 text-slate-700'
			default:
				return 'bg-slate-100 text-slate-700'
		}
	}

	const getRoleDisplayName = (role: string) => {
		switch (role) {
			case 'admin':
				return 'Admin'
			case 'ingestonly':
				return 'Ingest Only'
			case 'readonly':
				return 'Read Only'
			default:
				return role
		}
	}

	const handleLogout = () => {
		// Force a full page refresh when logging out to clear all state
		window.location.href = '/oauth2/sign_out'
	}

	return (
		<div className="relative">
			<button
				onClick={() => setShowDropdown(!showDropdown)}
				className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
				title={`User: ${userInfo.email}`}>
				<div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-500 text-white font-semibold text-sm">
					{userInfo.email.charAt(0).toUpperCase()}
				</div>
				<div className="hidden md:flex items-center gap-2">
					<span className="text-sm font-medium text-slate-700">{userInfo.email.split('@')[0]}</span>
					<svg
						className={`w-4 h-4 text-slate-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
					</svg>
				</div>
			</button>

			{showDropdown && (
				<>
					<div
						className="fixed inset-0 z-40"
						onClick={() => setShowDropdown(false)}
					/>
					<div className="absolute right-0 top-12 z-50 w-80 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden">
						<div className="p-4 bg-slate-50 border-b border-slate-200">
							<div className="flex items-center gap-3">
								<div className="flex items-center justify-center w-12 h-12 rounded-full bg-brand-500 text-white font-semibold text-lg">
									{userInfo.email.charAt(0).toUpperCase()}
								</div>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-semibold text-slate-900 truncate">{userInfo.email}</p>
									<div className="flex items-center gap-2 mt-1">
										<span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getRoleBadgeColor(userInfo.role)}`}>
											{getRoleDisplayName(userInfo.role)}
										</span>
										{!userInfo.is_authenticated && (
											<span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
												Unauthenticated
											</span>
										)}
									</div>
								</div>
							</div>
						</div>

						<div className="p-4 space-y-3">
							{userInfo.groups && userInfo.groups.length > 0 && (
								<>
									<div>
										<button
											onClick={() => setShowGroups(!showGroups)}
											className="w-full flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 hover:text-slate-700 transition-colors">
											<span>Groups ({userInfo.groups.length})</span>
											<svg
												className={`w-3 h-3 transition-transform ${showGroups ? 'rotate-180' : ''}`}
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
											</svg>
										</button>
										{showGroups && (
											<div className="flex flex-wrap gap-1 animate-fadeIn">
												{userInfo.groups.map((group, idx) => (
													<span
														key={idx}
														className="inline-flex items-center px-2 py-1 rounded text-xs bg-slate-100 text-slate-700">
														{group}
													</span>
												))}
											</div>
										)}
									</div>
									<div className="border-t border-slate-200"></div>
								</>
							)}

							<div>
								<p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Permissions</p>
								<div className="space-y-1.5">
									<div className="flex items-center justify-between text-sm">
										<span className="text-slate-600">Read Access</span>
										{userInfo.permissions.can_read ? (
											<span className="text-emerald-600 font-medium">✓</span>
										) : (
											<span className="text-slate-400">✗</span>
										)}
									</div>
									<div className="flex items-center justify-between text-sm">
										<span className="text-slate-600">Ingest Data</span>
										{userInfo.permissions.can_ingest ? (
											<span className="text-emerald-600 font-medium">✓</span>
										) : (
											<span className="text-slate-400">✗</span>
										)}
									</div>
									<div className="flex items-center justify-between text-sm">
										<span className="text-slate-600">Delete Resources</span>
										{userInfo.permissions.can_delete ? (
											<span className="text-emerald-600 font-medium">✓</span>
										) : (
											<span className="text-slate-400">✗</span>
										)}
									</div>
								</div>
							</div>
						</div>

						<div className="p-3 bg-slate-50 border-t border-slate-200">
							<button
								onClick={handleLogout}
								className="block w-full px-4 py-2 text-center text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors">
								Sign Out
							</button>
						</div>
					</div>
				</>
			)}
		</div>
	)
}
