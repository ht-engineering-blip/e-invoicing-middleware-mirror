import mongoose from 'mongoose';
import { databaseConfig } from '../../../@config';
  

export const connectMongo = async () => { 
   return await mongoose.connect(databaseConfig?.data?.mongoUri as string, {
      dbName: databaseConfig?.data?.dbName,
      // Additional MongoDB connection options
      maxPoolSize: 10,
      minPoolSize: 2,
      socketTimeoutMS: 45000,
    }).then(() => {
      console.info(`MongoDB connected successfully to database: ${databaseConfig?.data?.dbName}`);
    }).catch((err: any) => {
      console.error('MongoDB connection error:', err);
      throw err;
    }); 
};

// Handle connection events
mongoose.connection.on('connected', () => {
  console.info('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('Mongoose disconnected from MongoDB');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.info('Mongoose connection closed due to app termination');
  process.exit(0);
});

export default mongoose;
