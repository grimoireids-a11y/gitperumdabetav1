/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './components/auth/LoginPage';
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { Navbar } from './components/layout/Navbar';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { RiskUniverseModule } from './components/risk/RiskUniverseModule';
import { AuditUniverseModule } from './components/risk/AuditUniverseModule';
import { RiskRegisterModule } from './components/risk/RiskRegisterModule';
import { RiskProfileModule } from './components/risk/RiskProfileModule';
import { RiskAnnualReportModule } from './components/risk/RiskAnnualReportModule';
import { RCSAModule } from './components/risk/RCSAModule';
import { SelfAssessmentBPKPModule } from './components/assessment/SelfAssessmentBPKPModule';
import { KPIModule } from './components/kpi/KPIModule';
import { RKAModule } from './components/pkpt/RKAModule';
import { PKPTModule } from './components/pkpt/PKPTModule';
import { SPIProgramsModule } from './components/pkpt/SPIProgramsModule';
import { AuditAssignmentModule } from './components/audit/AuditAssignmentModule';
import { AuditProgramModule } from './components/audit/AuditProgramModule';
import { WorkPaperModule } from './components/audit/WorkPaperModule';
import { AuditReportModule } from './components/audit/AuditReportModule';
import { SPIPeriodicReportModule } from './components/audit/SPIPeriodicReportModule';
import { FindingsModule } from './components/findings/FindingsModule';
import { FollowUpModule } from './components/findings/FollowUpModule';
import { InvestigationModule } from './components/investigation/InvestigationModule';
import { WBSModule } from './components/wbs/WBSModule';
import { RegulationModule } from './components/compliance/RegulationModule';
import { UserManagementModule } from './components/admin/UserManagementModule';
import { MasterUnitsModule } from './components/admin/MasterUnitsModule';
import { SignatoriesModule } from './components/admin/SignatoriesModule';
import { AppBrandingModule } from './components/admin/AppBrandingModule';
import { AppBrandingProvider, useAppBranding } from './context/AppBrandingContext';
import { FiscalYearProvider } from './context/FiscalYearContext';
import { RKAItem, AuditUniverseItem } from './types/audit';
import { AiAssistantModal } from './components/ai/AiAssistantModal';
import { AppManualBookModal } from './components/common/AppManualBookModal';
import { DatabaseBackupModal } from './components/admin/DatabaseBackupModal';
import { Shield, Loader2 } from 'lucide-react';

const AppContent: React.FC = () => {
  const { currentUser, userProfile, loading } = useAuth();
  const { branding } = useAppBranding();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedAssignmentForLha, setSelectedAssignmentForLha] = useState<string | undefined>(undefined);
  const [selectedAssignmentForPka, setSelectedAssignmentForPka] = useState<string | undefined>(undefined);
  const [selectedAssignmentForKka, setSelectedAssignmentForKka] = useState<string | undefined>(undefined);
  const [selectedAssignmentForFindings, setSelectedAssignmentForFindings] = useState<string | undefined>(undefined);
  const [prefillForAssignment, setPrefillForAssignment] = useState<any>(null);
  const [prefillForFindings, setPrefillForFindings] = useState<any>(null);
  const [prefillRkaForPkpt, setPrefillRkaForPkpt] = useState<RKAItem | null>(null);
  const [prefillUniverseForPkpt, setPrefillUniverseForPkpt] = useState<AuditUniverseItem | null>(null);
  const [selectedFindingForFollowUp, setSelectedFindingForFollowUp] = useState<string | undefined>(undefined);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiModalContext, setAiModalContext] = useState<any>(null);
  const [isManualBookOpen, setIsManualBookOpen] = useState(false);
  const [isDatabaseBackupOpen, setIsDatabaseBackupOpen] = useState(false);
  const [databaseBackupTab, setDatabaseBackupTab] = useState<'export' | 'import'>('export');

  const isFullAccess = userProfile?.role === 'KEPALA_SPI' || userProfile?.role === 'ADMIN_SISTEM';
  const isViewer = userProfile?.role === 'VIEWER';
  const isExternalAuditor = userProfile?.role === 'AUDITOR_EKSTERNAL';

  const canAccessTab = React.useCallback(
    (tab: ActiveTab) => {
      if (isFullAccess) return true;
      if (isViewer) return tab !== 'user_management' && tab !== 'app_branding';
      if (isExternalAuditor) return tab === 'findings' || tab === 'follow_ups';
      return (
        tab === 'dashboard' ||
        tab === 'risk_register' ||
        tab === 'kpi_management' ||
        tab === 'follow_ups'
      );
    },
    [isFullAccess, isViewer, isExternalAuditor]
  );

  // Guard routes per role
  React.useEffect(() => {
    if (!loading && userProfile && !canAccessTab(activeTab)) {
      setActiveTab(isExternalAuditor ? 'findings' : 'dashboard');
    }
  }, [loading, userProfile, canAccessTab, activeTab, isExternalAuditor]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#072114] text-white">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 shadow-xl ring-4 ring-emerald-500/20 mb-4 animate-pulse overflow-hidden p-2">
          {branding.logoType === 'image' && branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.appName} className="w-full h-full object-contain" />
          ) : (
            <Shield className="w-8 h-8 text-emerald-100" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          <span>Memuat Sistem Informasi {branding.appName || 'SPI SMART'}...</span>
        </div>
        <p className="text-[11px] text-emerald-400/80 mt-1">
          {branding.institutionName || 'Perumda Air Minum Tirta Saiyo Pasaman'}
        </p>
      </div>
    );
  }

  if (!currentUser || !userProfile) {
    return <LoginPage />;
  }

  const handleOpenAiWithContext = (ctx: any) => {
    if (!isFullAccess) return;
    setAiModalContext(ctx);
    setIsAiModalOpen(true);
  };

  const renderActiveTab = () => {
    if (!canAccessTab(activeTab)) {
      return (
        <DashboardOverview
          onNavigateTo={(tab) => {
            if (canAccessTab(tab)) {
              setActiveTab(tab);
            }
          }}
        />
      );
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardOverview
            onNavigateTo={(tab) => {
              if (canAccessTab(tab)) {
                setActiveTab(tab);
              }
            }}
            onOpenAiAssistant={
              isFullAccess
                ? () => {
                    setAiModalContext(null);
                    setIsAiModalOpen(true);
                  }
                : undefined
            }
          />
        );
      case 'risk_universe':
        return <RiskUniverseModule />;
      case 'audit_universe':
        return (
          <AuditUniverseModule
            onNavigateToPkptWithUniverse={(auItem) => {
              setPrefillUniverseForPkpt(auItem);
              setActiveTab('pkpt');
            }}
          />
        );
      case 'risk_register':
        return (
          <RiskRegisterModule
            onOpenAiAssistantWithContext={isFullAccess ? handleOpenAiWithContext : undefined}
            onNavigateToPkpt={
              isFullAccess
                ? () => {
                    setActiveTab('pkpt');
                  }
                : undefined
            }
          />
        );
      case 'risk_profile':
        return (
          <RiskProfileModule
            onNavigateToAnnualReport={() => setActiveTab('risk_annual_report')}
            onNavigateToRiskRegister={() => setActiveTab('risk_register')}
          />
        );
      case 'risk_annual_report':
        return (
          <RiskAnnualReportModule
            onNavigateToRiskProfile={() => setActiveTab('risk_profile')}
          />
        );
      case 'rcsa':
        return <RCSAModule />;
      case 'bpkp_assessment':
        return <SelfAssessmentBPKPModule />;
      case 'kpi_management':
        return <KPIModule />;
      case 'rka':
        return (
          <RKAModule
            onNavigateToPkptWithRka={(rkaItem) => {
              setPrefillRkaForPkpt(rkaItem);
              setActiveTab('pkpt');
            }}
          />
        );
      case 'pkpt':
        return (
          <PKPTModule
            initialPrefillFromRka={prefillRkaForPkpt}
            onClearPrefillRka={() => setPrefillRkaForPkpt(null)}
            initialPrefillFromUniverse={prefillUniverseForPkpt}
            onClearPrefillUniverse={() => setPrefillUniverseForPkpt(null)}
            onNavigateToAssignment={(pkptItem) => {
              setPrefillForAssignment(pkptItem);
              setActiveTab('audit_assignments');
            }}
          />
        );
      case 'spi_programs':
        return <SPIProgramsModule />;
      case 'audit_assignments':
        return (
          <AuditAssignmentModule
            initialPrefillFromPkpt={prefillForAssignment}
            onNavigateToLha={(assignmentId) => {
              setSelectedAssignmentForLha(assignmentId);
              setActiveTab('audit_reports');
            }}
            onNavigateToPka={(assignmentId) => {
              setSelectedAssignmentForPka(assignmentId);
              setActiveTab('audit_program');
            }}
            onNavigateToKka={(assignmentId) => {
              setSelectedAssignmentForKka(assignmentId);
              setActiveTab('work_papers');
            }}
            onNavigateToFindings={(assignmentId) => {
              setSelectedAssignmentForFindings(assignmentId);
              setActiveTab('findings');
            }}
          />
        );
      case 'audit_program':
        return <AuditProgramModule initialAssignmentId={selectedAssignmentForPka} />;
      case 'work_papers':
        return (
          <WorkPaperModule
            initialAssignmentId={selectedAssignmentForKka}
            onOpenAiAssistantWithContext={isFullAccess ? handleOpenAiWithContext : undefined}
            onNavigateToFindings={
              isViewer
                ? undefined
                : (prefill) => {
                    setPrefillForFindings(prefill);
                    setActiveTab('findings');
                  }
            }
          />
        );
      case 'audit_reports':
        return (
          <AuditReportModule
            onOpenAiAssistantWithContext={isFullAccess ? handleOpenAiWithContext : undefined}
            initialAssignmentId={selectedAssignmentForLha}
            onNavigateToFindings={() => setActiveTab('findings')}
          />
        );
      case 'spi_periodic_reports':
        return <SPIPeriodicReportModule />;
      case 'findings':
        return (
          <FindingsModule
            initialAssignmentId={selectedAssignmentForFindings}
            initialPrefillFromKka={prefillForFindings}
            onOpenAiAssistantWithContext={isFullAccess ? handleOpenAiWithContext : undefined}
            onNavigateToLha={(assignmentId) => {
              setSelectedAssignmentForLha(assignmentId);
              setActiveTab('audit_reports');
            }}
            onNavigateToFollowUp={(findingId) => {
              setSelectedFindingForFollowUp(findingId);
              setActiveTab('follow_ups');
            }}
          />
        );
      case 'follow_ups':
        return <FollowUpModule initialFindingId={selectedFindingForFollowUp} />;
      case 'wbs_management':
        return (
          <WBSModule
            onNavigateToFindings={() => setActiveTab('findings')}
          />
        );
      case 'investigations':
        return (
          <InvestigationModule
            onOpenAiAssistantWithContext={isFullAccess ? handleOpenAiWithContext : undefined}
          />
        );
      case 'regulations':
        return <RegulationModule />;
      case 'user_management':
        return <UserManagementModule />;
      case 'master_units':
        return <MasterUnitsModule />;
      case 'signatories':
        return <SignatoriesModule />;
      case 'app_branding':
        return <AppBrandingModule />;
      default:
        return (
          <DashboardOverview
            onNavigateTo={(tab) => {
              if (canAccessTab(tab)) setActiveTab(tab);
            }}
            onOpenAiAssistant={
              isFullAccess
                ? () => {
                    setAiModalContext(null);
                    setIsAiModalOpen(true);
                  }
                : undefined
            }
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex font-sans antialiased selection:bg-emerald-500 selection:text-white">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={isMobileSidebarOpen}
        setIsOpen={setIsMobileSidebarOpen}
        onOpenManualBook={() => setIsManualBookOpen(true)}
        onOpenDatabaseBackup={
          isFullAccess
            ? (mode) => {
                setDatabaseBackupTab(mode);
                setIsDatabaseBackupOpen(true);
              }
            : undefined
        }
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-72 transition-all">
        {/* Top Navbar */}
        <Navbar
          activeTab={activeTab}
          onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
          onOpenManualBook={() => setIsManualBookOpen(true)}
          onOpenAiAssistant={
            isFullAccess
              ? () => {
                  setAiModalContext(null);
                  setIsAiModalOpen(true);
                }
              : undefined
          }
          onNavigateToTab={(tab) => {
            if (canAccessTab(tab)) {
              setActiveTab(tab);
            }
          }}
        />

        {/* Viewport Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {renderActiveTab()}
        </main>
      </div>

      {/* AI Assistant Modal */}
      <AiAssistantModal
        isOpen={isAiModalOpen}
        onClose={() => {
          setIsAiModalOpen(false);
          setAiModalContext(null);
        }}
        prefilledContext={aiModalContext}
      />

      {/* Comprehensive App Manual Book Modal (All Roles) */}
      <AppManualBookModal
        isOpen={isManualBookOpen}
        onClose={() => setIsManualBookOpen(false)}
      />

      {/* Super User Database Export & Import Modal */}
      {isFullAccess && (
        <DatabaseBackupModal
          isOpen={isDatabaseBackupOpen}
          initialTab={databaseBackupTab}
          onClose={() => setIsDatabaseBackupOpen(false)}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppBrandingProvider>
        <FiscalYearProvider>
          <AppContent />
        </FiscalYearProvider>
      </AppBrandingProvider>
    </AuthProvider>
  );
}
