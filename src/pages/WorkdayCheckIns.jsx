import React from 'react';
import DailyReportSettings from '../components/DailyReportSettings';
import Layout from '../components/Layout';

const WorkdayCheckIns = () => (
  <Layout
    title="Workday Check-ins"
    eyebrow="Settings · Superadmin"
    heading="Workday Check-ins"
    description="Choose who needs to submit a start-of-day plan and an end-of-day summary."
  >
    <DailyReportSettings />
  </Layout>
);

export default WorkdayCheckIns;
